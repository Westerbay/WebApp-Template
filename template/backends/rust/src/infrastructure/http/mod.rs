use axum::{
    extract::{ConnectInfo, Request},
    http::HeaderValue,
    middleware::Next,
    response::Response,
};
use std::net::SocketAddr;

pub(crate) async fn request_log(req: Request, next: Next) -> Response {
    let request_id = format!("{:032x}", rand::random::<u128>());
    let route = match req.uri().path() {
        "/api/me" => "/api/me",
        "/api/users" => "/api/users",
        "/health/live" => "/health/live",
        "/health/ready" => "/health/ready",
        path if path.starts_with("/api/auth/") => "/api/auth/*",
        _ => "unmatched",
    };
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
