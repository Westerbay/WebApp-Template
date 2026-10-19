//! The existing frontend composes its account summary with the sample users table.
use crate::{CurrentUser, schema::AppSchema};
use axum::{Extension, Json, extract::Query, http::StatusCode};
use better_auth::{
    integrations::axum::CurrentSession,
    prelude::AuthUser,
    seaorm::{
        DatabaseConnection,
        sea_orm::{ConnectionTrait, Statement},
    },
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct UsersQuery {
    #[param(minimum = 1, maximum = 100, default = 20)]
    limit: Option<u16>,
    #[param(min_length = 1, max_length = 256)]
    cursor: Option<String>,
    #[param(max_length = 100)]
    search: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsersPage {
    items: Vec<CurrentUser>,
    #[schema(required = true)]
    next_cursor: Option<String>,
}

#[utoipa::path(get, path = "/api/users", params(UsersQuery), responses((status = 200, description = "Cursor page of users", body = UsersPage), (status = 400, description = "Invalid query"), (status = 401, description = "No valid session"), (status = 403, description = "Unverified email")))]
pub async fn list(
    session: CurrentSession<AppSchema>,
    Extension(db): Extension<DatabaseConnection>,
    Query(query): Query<UsersQuery>,
) -> Result<Json<UsersPage>, StatusCode> {
    if !session.user.email_verified() {
        return Err(StatusCode::FORBIDDEN);
    }
    let limit = query.limit.unwrap_or(20);
    let search = query.search.unwrap_or_default().trim().to_owned();
    if !(1..=100).contains(&limit)
        || search.encode_utf16().count() > 100
        || query
            .cursor
            .as_ref()
            .is_some_and(|cursor| cursor.is_empty() || cursor.len() > 256)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let pattern = format!(
        "%{}%",
        search
            .to_lowercase()
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let rows=db.query_all_raw(Statement::from_sql_and_values(db.get_database_backend(),
        r"SELECT id,name,email,email_verified FROM users WHERE id > $1 AND (LOWER(name) LIKE $2 ESCAPE '\' OR LOWER(email) LIKE $2 ESCAPE '\') ORDER BY id ASC LIMIT $3",
        [query.cursor.unwrap_or_default().into(),pattern.into(),(i64::from(limit)+1).into()])).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    let more = rows.len() > usize::from(limit);
    let mut items = Vec::new();
    for row in rows.into_iter().take(usize::from(limit)) {
        items.push(CurrentUser {
            id: row
                .try_get("", "id")
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            name: row
                .try_get("", "name")
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            email: row
                .try_get("", "email")
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            email_verified: row
                .try_get("", "email_verified")
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        });
    }
    let next_cursor = if more {
        items.last().map(|user| user.id.clone())
    } else {
        None
    };
    Ok(Json(UsersPage { items, next_cursor }))
}
