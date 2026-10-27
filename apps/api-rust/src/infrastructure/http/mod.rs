use axum::{
    extract::{ConnectInfo, Request},
    http::HeaderValue,
    middleware::Next,
    response::Response,
};
use std::net::SocketAddr;

pub(crate) async fn request_log(req: Request, next: Next) -> Response {
    let request_id = format!("{:032x}", rand::random::<u128>());
    let route = req
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map(|path| path.as_str())
        .unwrap_or("unmatched");
    // Keep provider route details out of logs while application routes follow Axum metadata.
    let route = if route.starts_with("/api/auth/") {
        "/api/auth/*"
    } else {
        route
    };
    let route = route.to_owned();
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

pub(crate) async fn peer_headers(mut req: Request, next: Next) -> Response {
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

pub(crate) mod logging;

pub(crate) fn configure(
    router: axum::Router,
    web_origin: &str,
) -> Result<axum::Router, axum::http::header::InvalidHeaderValue> {
    use axum::{
        http::{Method, header::CONTENT_TYPE},
        middleware,
    };
    Ok(router
        .layer(middleware::from_fn(peer_headers))
        .layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin(HeaderValue::from_str(web_origin)?)
                .allow_credentials(true)
                .allow_methods([Method::GET, Method::POST])
                .allow_headers([CONTENT_TYPE]),
        )
        .layer(middleware::from_fn(request_log)))
}
