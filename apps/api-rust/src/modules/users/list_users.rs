use super::dto::{UsersPage, UsersQuery};
use crate::contracts::identity::CurrentUser;
use axum::http::StatusCode;
use better_auth::seaorm::{
    DatabaseConnection,
    sea_orm::{ConnectionTrait, Statement},
};

pub(super) async fn list_users(
    db: &DatabaseConnection,
    query: UsersQuery,
) -> Result<UsersPage, StatusCode> {
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
    let statement = Statement::from_sql_and_values(
        db.get_database_backend(),
        r"SELECT id,name,email,email_verified FROM users
          WHERE id > $1 AND (LOWER(name) LIKE $2 ESCAPE '\' OR LOWER(email) LIKE $2 ESCAPE '\')
          ORDER BY id ASC LIMIT $3",
        [
            query.cursor.unwrap_or_default().into(),
            pattern.into(),
            (i64::from(limit) + 1).into(),
        ],
    );
    let rows = db
        .query_all_raw(statement)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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
    Ok(UsersPage { items, next_cursor })
}
