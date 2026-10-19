pub mod hibp;
pub mod mail;
pub mod migrations;
pub mod openapi;
mod password;
pub mod quotas;
pub mod runtime;
pub mod schema;
pub mod settings;
mod signup;
pub mod smtp;
#[cfg(feature = "fixtures")]
pub mod test_server;
mod users;
mod verification;

use crate::{
    mail::Mailbox, password::ExactPasswordHasher, schema::AppSchema, signup::SignupWithVerification,
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, Request},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::get,
};
use better_auth::{
    AuthConfig, BetterAuth,
    integrations::axum::{AxumIntegration, CurrentSession},
    middleware::RateLimitConfig,
    plugins::{
        EmailPasswordPlugin, EmailVerificationPlugin, PasswordManagementPlugin,
        SessionManagementPlugin,
    },
    prelude::AuthUser,
    seaorm::{Database, DatabaseConnection, SeaOrmStore},
};
use serde::Serialize;
use std::{net::SocketAddr, sync::Arc};

pub struct AuthServices {
    pub mailbox: Mailbox,
    pub password_check: hibp::PasswordCheck,
}

impl AuthServices {
    pub fn configured(mailbox: Mailbox) -> better_auth::AuthResult<Self> {
        let password_check = if mailbox.environment().checks_passwords() {
            hibp::PasswordCheck::enabled()?
        } else {
            hibp::PasswordCheck::Offline
        };
        Ok(Self {
            mailbox,
            password_check,
        })
    }
}

pub struct Application {
    pub router: Router,
    pub auth: Arc<BetterAuth<AppSchema>>,
    pub mailbox: Mailbox,
    pub database: DatabaseConnection,
}

impl Application {
    pub async fn local() -> Result<Self, Box<dyn std::error::Error>> {
        Self::with_config(settings::local()).await
    }

    /// The prototype can only initialize a new, private in-memory database.
    pub async fn with_config(config: AuthConfig) -> Result<Self, Box<dyn std::error::Error>> {
        let database = Database::connect("sqlite::memory:").await?;
        Self::with_database(config, database).await
    }

    /// The caller must supply an empty disposable database (used by PostgreSQL tests).
    pub async fn with_database(
        config: AuthConfig,
        database: DatabaseConnection,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        schema::initialize_empty_database(&database).await?;
        Self::connect(
            config,
            database,
            AuthServices::configured(Mailbox::default())?,
        )
        .await
    }

    /// Attach another API replica to an already initialized application database.
    pub async fn connect(
        config: AuthConfig,
        database: DatabaseConnection,
        services: AuthServices,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let mailbox = services.mailbox;
        let web_origin = config
            .trusted_origins
            .first()
            .ok_or("Missing web origin")?
            .clone();
        let hasher = Arc::new(ExactPasswordHasher {
            check: services.password_check,
        });
        let verification = || {
            EmailVerificationPlugin::new()
                .verification_token_expiry(chrono::Duration::hours(settings::VERIFICATION_HOURS))
                .auto_sign_in_after_verification(false)
                .custom_send_verification_email(Arc::new(mailbox.clone()))
        };
        let store = SeaOrmStore::<AppSchema>::new(config.clone(), database.clone());
        let auth = Arc::new(
            BetterAuth::<AppSchema>::new(config)
                .store(store)
                .rate_limit(RateLimitConfig::new().enabled(false))
                .middleware(quotas::SharedQuotas(database.clone()))
                .plugin(SignupWithVerification {
                    password: EmailPasswordPlugin::new()
                        .require_email_verification(true)
                        .auto_sign_in(false)
                        .password_min_length(settings::PASSWORD_MIN_LENGTH)
                        .password_max_length(settings::PASSWORD_MAX_LENGTH)
                        .password_hasher(hasher.clone()),
                    verification: verification(),
                    hasher: hasher.clone(),
                })
                .plugin(verification::StrictEmailVerification(verification()))
                .plugin(
                    PasswordManagementPlugin::new()
                        .reset_token_expiry_hours(settings::RESET_HOURS)
                        .revoke_sessions_on_password_reset(true)
                        .password_hasher(hasher)
                        .send_reset_password(Arc::new(mailbox.clone())),
                )
                .plugin(SessionManagementPlugin::new())
                .build()
                .await?,
        );
        let router = Router::new()
            .route(
                "/health/live",
                get(|| async { Json(serde_json::json!({"status":"ok"})) }),
            )
            .route(
                "/health/ready",
                get(ready).layer(axum::Extension(database.clone())),
            )
            .route("/api/me", get(me))
            .route(
                "/api/users",
                get(users::list).layer(axum::Extension(database.clone())),
            )
            .route("/openapi.json", get(|| async { Json(openapi::document()) }))
            .nest(settings::AUTH_PATH, auth.clone().axum_router())
            .with_state(auth.clone())
            .layer(middleware::from_fn_with_state(
                quotas::SharedQuotas(database.clone()),
                api_quota,
            ))
            .layer(middleware::from_fn(peer_headers))
            .layer(
                tower_http::cors::CorsLayer::new()
                    .allow_origin(HeaderValue::from_str(&web_origin)?)
                    .allow_credentials(true)
                    .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
                    .allow_headers([axum::http::header::CONTENT_TYPE]),
            )
            .layer(middleware::from_fn(request_log));
        Ok(Self {
            router,
            auth,
            mailbox,
            database,
        })
    }
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
struct CurrentUser {
    id: String,
    name: String,
    #[schema(format = Email)]
    email: String,
    email_verified: bool,
}

async fn ready(axum::Extension(database): axum::Extension<DatabaseConnection>) -> StatusCode {
    use better_auth::seaorm::sea_orm::ConnectionTrait;
    match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        database.execute_unprepared("SELECT 1"),
    )
    .await
    {
        Ok(Ok(_)) => StatusCode::OK,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    }
}

async fn request_log(req: Request, next: Next) -> Response {
    let request_id = format!("{:032x}", rand::random::<u128>());
    let route = match req.uri().path() {
        "/api/me" => "/api/me",
        "/api/users" => "/api/users",
        "/health/live" => "/health/live",
        "/health/ready" => "/health/ready",
        path if path.starts_with("/api/auth/") => "/api/auth/*",
        _ => "unmatched",
    };
    let started = std::time::Instant::now();
    let mut response = next.run(req).await;
    tracing::info!(
        event = "http.request",
        route,
        status = response.status().as_u16(),
        duration_ms = started.elapsed().as_millis() as u64,
        request_id
    );
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert("x-request-id", value);
    }
    response
}

#[utoipa::path(get, path = "/api/me", responses((status = 200, description = "Verified current user", body = CurrentUser), (status = 401, description = "No valid session"), (status = 403, description = "Unverified email")))]
async fn me(session: CurrentSession<AppSchema>) -> Result<Json<CurrentUser>, StatusCode> {
    if !session.user.email_verified() {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Json(CurrentUser {
        id: session.user.id().into_owned(),
        name: session
            .user
            .name()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
            .to_owned(),
        email: session
            .user
            .email()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
            .to_owned(),
        email_verified: session.user.email_verified(),
    }))
}

async fn peer_headers(mut req: Request, next: Next) -> Response {
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| info.0.ip().to_string());
    for header in ["x-forwarded-for", "x-real-ip", "x-auth-client-ip"] {
        req.headers_mut().remove(header);
    }
    if let Some(peer) = peer.and_then(|value| HeaderValue::from_str(&value).ok()) {
        req.headers_mut().insert("x-forwarded-for", peer);
    }
    next.run(req).await
}

async fn api_quota(
    axum::extract::State(quota): axum::extract::State<quotas::SharedQuotas>,
    req: Request,
    next: Next,
) -> Response {
    use axum::response::IntoResponse;
    if !matches!(req.uri().path(), "/api/me" | "/api/users") {
        return next.run(req).await;
    }
    let peer = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|header| header.to_str().ok())
        .unwrap_or("unknown");
    let maximum = if req.uri().path() == "/api/me" {
        30
    } else {
        120
    };
    match quota
        .consume(&format!("{peer}:{}", req.uri().path()), maximum, 60)
        .await
    {
        Ok(None) => next.run(req).await,
        Ok(Some(seconds)) => (
            StatusCode::TOO_MANY_REQUESTS,
            [(axum::http::header::RETRY_AFTER, seconds.to_string())],
            Json(serde_json::json!({"code":"TOO_MANY_REQUESTS"})),
        )
            .into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"code":"SERVICE_UNAVAILABLE"})),
        )
            .into_response(),
    }
}
