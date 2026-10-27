use axum::{
    body::Body,
    http::{Method, Request, StatusCode},
};
use tower::ServiceExt;
use webapp_api::{Application, config::auth as settings};
mod support;

async fn request(app: &Application, path: &str) -> axum::response::Response {
    app.router
        .clone()
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn module_quotas_preserve_session_protection_and_exempt_other_routes() {
    let app = support::fixture(settings::local()).await;
    for (path, maximum) in [("/api/me", 30), ("/api/users", 120)] {
        for _ in 0..maximum {
            assert_eq!(request(&app, path).await.status(), StatusCode::UNAUTHORIZED);
        }
        let limited = request(&app, path).await;
        assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(limited.headers().contains_key("retry-after"));
    }
    for path in ["/health/live", "/health/ready", "/openapi.json"] {
        let response = request(&app, path).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().contains_key("x-request-id"));
    }
    assert_eq!(
        request(&app, "/missing").await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn cors_preflight_runs_before_module_session_and_quota_middleware() {
    let app = support::fixture(settings::local()).await;
    let response = app
        .router
        .oneshot(
            Request::builder()
                .method(Method::OPTIONS)
                .uri("/api/me")
                .header("origin", settings::WEB_ORIGIN)
                .header("access-control-request-method", "GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        settings::WEB_ORIGIN
    );
    assert_eq!(
        response.headers()["access-control-allow-credentials"],
        "true"
    );
    assert!(response.headers().contains_key("x-request-id"));
}
