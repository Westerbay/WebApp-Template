pub mod store;

use axum::{Json, extract::Request, http::StatusCode, middleware::Next, response::Response};

pub(crate) async fn api_quota(
    axum::extract::State(quota): axum::extract::State<store::SharedQuotas>,
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
