pub mod store;

use axum::{
    Json,
    extract::{MatchedPath, Request},
    http::StatusCode,
    middleware::Next,
    response::Response,
};

use better_auth::seaorm::DatabaseConnection;

const API_QUOTA_WINDOW_SECONDS: i64 = 60;

#[derive(Clone)]
pub(crate) struct ApiQuota {
    store: store::SharedQuotas,
    maximum: i32,
}

impl ApiQuota {
    pub(crate) fn new(database: DatabaseConnection, maximum: i32) -> Self {
        Self {
            store: store::SharedQuotas(database),
            maximum,
        }
    }
}

pub(crate) async fn api_quota(
    axum::extract::State(quota): axum::extract::State<ApiQuota>,
    req: Request,
    next: Next,
) -> Response {
    use axum::response::IntoResponse;
    let peer = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|header| header.to_str().ok())
        .unwrap_or("unknown");
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str())
        .unwrap_or("unmatched");
    match quota
        .store
        .consume(
            &format!("{peer}:{route}"),
            quota.maximum,
            API_QUOTA_WINDOW_SECONDS,
        )
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
