pub(crate) mod dto;
mod list_users;

use crate::infrastructure::database::schema::AppSchema;
use crate::infrastructure::{
    auth::AuthState,
    rate_limit::{self, ApiQuota},
};
use axum::{Extension, Json, Router, extract::Query, http::StatusCode, middleware, routing::get};
use better_auth::{
    integrations::axum::CurrentSession, prelude::AuthUser, seaorm::DatabaseConnection,
};
use dto::{UsersPage, UsersQuery};

const REQUESTS_PER_MINUTE: i32 = 120;

pub(crate) fn router(database: DatabaseConnection) -> Router<AuthState> {
    Router::new()
        .route("/api/users", get(list))
        .layer(Extension(database.clone()))
        .layer(middleware::from_fn_with_state(
            ApiQuota::new(database, REQUESTS_PER_MINUTE),
            rate_limit::api_quota,
        ))
}

#[utoipa::path(get, path = "/api/users", tag = "users", params(UsersQuery), responses((status = 200, description = "Cursor page of users", body = UsersPage), (status = 400, description = "Invalid query"), (status = 401, description = "No valid session"), (status = 403, description = "Unverified email")))]
async fn list(
    session: CurrentSession<AppSchema>,
    Extension(db): Extension<DatabaseConnection>,
    Query(query): Query<UsersQuery>,
) -> Result<Json<UsersPage>, StatusCode> {
    if !session.user.email_verified() {
        return Err(StatusCode::FORBIDDEN);
    }
    list_users::list_users(&db, query).await.map(Json)
}

#[derive(utoipa::OpenApi)]
#[openapi(paths(list), components(schemas(UsersPage)))]
pub(crate) struct ApiDocument;
