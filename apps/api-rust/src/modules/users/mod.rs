pub(crate) mod dto;
mod list_users;

use crate::infrastructure::database::schema::AppSchema;
use axum::{Extension, Json, extract::Query, http::StatusCode};
use better_auth::{
    integrations::axum::CurrentSession, prelude::AuthUser, seaorm::DatabaseConnection,
};
use dto::{UsersPage, UsersQuery};

#[utoipa::path(get, path = "/api/users", tag = "users", params(UsersQuery), responses((status = 200, description = "Cursor page of users", body = UsersPage), (status = 400, description = "Invalid query"), (status = 401, description = "No valid session"), (status = 403, description = "Unverified email")))]
pub async fn list(
    session: CurrentSession<AppSchema>,
    Extension(db): Extension<DatabaseConnection>,
    Query(query): Query<UsersQuery>,
) -> Result<Json<UsersPage>, StatusCode> {
    if !session.user.email_verified() {
        return Err(StatusCode::FORBIDDEN);
    }
    list_users::list_users(&db, query).await.map(Json)
}
