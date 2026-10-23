use axum::{Json, http::StatusCode};
use better_auth::seaorm::DatabaseConnection;

pub(crate) async fn live() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status":"ok"}))
}

pub(crate) async fn ready(
    axum::Extension(database): axum::Extension<DatabaseConnection>,
) -> StatusCode {
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
