use crate::infrastructure::{
    auth::AuthState,
    rate_limit::{self, ApiQuota},
};
use crate::{contracts::identity::CurrentUser, infrastructure::database::schema::AppSchema};
use axum::{Json, Router, http::StatusCode, middleware, routing::get};
use better_auth::{
    integrations::axum::CurrentSession, prelude::AuthUser, seaorm::DatabaseConnection,
};

const REQUESTS_PER_MINUTE: i32 = 30;

pub(crate) fn router(database: DatabaseConnection) -> Router<AuthState> {
    Router::new()
        .route("/api/me", get(me))
        .layer(middleware::from_fn_with_state(
            ApiQuota::new(database, REQUESTS_PER_MINUTE),
            rate_limit::api_quota,
        ))
}

#[utoipa::path(get, path = "/api/me", tag = "identity", responses((status = 200, description = "Verified current user", body = CurrentUser), (status = 401, description = "No valid session"), (status = 403, description = "Unverified email")))]
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

#[derive(utoipa::OpenApi)]
#[openapi(paths(me), components(schemas(CurrentUser)))]
pub(crate) struct ApiDocument;
