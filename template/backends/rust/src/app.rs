use crate::{
    config::auth as settings,
    infrastructure::{
        auth::{self, AuthServices},
        database::schema::{self, AppSchema},
        email::mail::Mailbox,
        http,
        rate_limit::{self, store as quotas},
    },
    modules::{health, identity, users},
    openapi,
};
use axum::{Json, Router, http::HeaderValue, middleware, routing::get};
use better_auth::{
    AuthConfig, BetterAuth,
    integrations::axum::AxumIntegration,
    seaorm::{Database, DatabaseConnection},
};
use std::sync::Arc;

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
        let mailbox = services.mailbox.clone();
        let web_origin = config
            .trusted_origins
            .first()
            .ok_or("Missing web origin")?
            .clone();
        let auth = auth::create(config, database.clone(), services).await?;
        let router = Router::new()
            .route("/health/live", get(health::live))
            .route(
                "/health/ready",
                get(health::ready).layer(axum::Extension(database.clone())),
            )
            .route("/api/me", get(identity::me))
            .route(
                "/api/users",
                get(users::list).layer(axum::Extension(database.clone())),
            )
            .route("/openapi.json", get(|| async { Json(openapi::document()) }))
            .nest(settings::AUTH_PATH, auth.clone().axum_router())
            .with_state(auth.clone())
            .layer(middleware::from_fn_with_state(
                quotas::SharedQuotas(database.clone()),
                rate_limit::api_quota,
            ))
            .layer(middleware::from_fn(http::peer_headers))
            .layer(
                tower_http::cors::CorsLayer::new()
                    .allow_origin(HeaderValue::from_str(&web_origin)?)
                    .allow_credentials(true)
                    .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
                    .allow_headers([axum::http::header::CONTENT_TYPE]),
            )
            .layer(middleware::from_fn(http::request_log));
        Ok(Self {
            router,
            auth,
            mailbox,
            database,
        })
    }
}
