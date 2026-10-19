//! Regression tests for the two upstream discrepancies and their security edges.
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt;
use webapp_api::settings;
mod support;
use support::fixture;

#[tokio::test]
async fn verification_token_must_be_rejected_at_its_expiry_boundary() {
    let app = fixture(settings::local()).await;
    use better_auth::prelude::{AuthUser, CreateUser};
    let user = app
        .auth
        .store()
        .create_user(CreateUser::new().with_email("expiry@example.test"))
        .await
        .unwrap();
    let now = chrono::Utc::now().timestamp();
    let token = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({"email":"expiry@example.test", "iat":now - 86400, "exp":now}),
        &jsonwebtoken::EncodingKey::from_secret(app.auth.config().secret.as_bytes()),
    )
    .unwrap();
    let request = Request::builder()
        .uri(format!("/api/auth/verify-email?token={token}"))
        .body(Body::empty())
        .unwrap();
    let response = app.router.oneshot(request).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::BAD_REQUEST,
        "release blocker: verification accepts expired tokens during JWT clock leeway"
    );
    assert!(
        !app.auth
            .store()
            .get_user_by_id(&user.id())
            .await
            .unwrap()
            .unwrap()
            .email_verified()
    );
}

#[tokio::test]
async fn unverified_email_must_not_create_a_login_session() {
    let app = fixture(settings::local()).await;
    let signup = Request::builder().method("POST").uri("/api/auth/sign-up/email")
        .header("origin", settings::WEB_ORIGIN).header("content-type", "application/json")
        .body(Body::from(json!({"email":"unverified@example.test", "name":"Unverified", "password":"Local-Application-2026!"}).to_string())).unwrap();
    assert_eq!(
        app.router.clone().oneshot(signup).await.unwrap().status(),
        StatusCode::OK
    );
    let signin = Request::builder()
        .method("POST")
        .uri("/api/auth/sign-in/email")
        .header("origin", settings::WEB_ORIGIN)
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"email":"unverified@example.test", "password":"Local-Application-2026!"})
                .to_string(),
        ))
        .unwrap();
    let response = app.router.oneshot(signin).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::FORBIDDEN,
        "release blocker: upstream ignores require_email_verification for email sign-in"
    );
    assert!(response.headers().get("set-cookie").is_none());
}

#[tokio::test]
async fn expired_verification_cannot_redirect_to_an_untrusted_origin() {
    let app = fixture(settings::local()).await;
    let now = chrono::Utc::now().timestamp();
    let token = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({"email":"expiry@example.test","exp":now,"iat":now-86400}),
        &jsonwebtoken::EncodingKey::from_secret(app.auth.config().secret.as_bytes()),
    )
    .unwrap();
    for callback in ["https://evil.test/", "//evil.test/path"] {
        let mut url = url::Url::parse("http://localhost/api/auth/verify-email").unwrap();
        url.query_pairs_mut()
            .append_pair("token", &token)
            .append_pair("callbackURL", callback);
        let request = Request::builder()
            .uri(format!("{}?{}", url.path(), url.query().unwrap()))
            .body(Body::empty())
            .unwrap();
        let response = app.router.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(response.headers().get("location").is_none());
    }
}

#[tokio::test]
async fn invalid_credentials_do_not_disclose_unverified_accounts_or_issue_cookies() {
    use better_auth::prelude::CreateUser;
    let app = fixture(settings::local()).await;
    app.auth
        .store()
        .create_user(CreateUser::new().with_email("unverified@example.test"))
        .await
        .unwrap();
    for email in ["unverified@example.test", "unknown@example.test"] {
        let request = Request::builder()
            .method("POST")
            .uri("/api/auth/sign-in/email")
            .header("origin", settings::WEB_ORIGIN)
            .header("content-type", "application/json")
            .body(Body::from(json!({"email":email,"password":""}).to_string()))
            .unwrap();
        let response = app.router.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(response.headers().get("set-cookie").is_none());
    }
}

#[tokio::test]
async fn malformed_signin_retains_upstream_client_errors() {
    for body in [
        r#"{}"#,
        r#"{"email":"alice@example.test","password":null}"#,
        r#"{"email":"alice@example.test","password":42}"#,
        "invalid-json",
    ] {
        let app = fixture(settings::local()).await;
        let request = Request::builder()
            .method("POST")
            .uri("/api/auth/sign-in/email")
            .header("origin", settings::WEB_ORIGIN)
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap();
        let response = app.router.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(response.headers().get("set-cookie").is_none());
    }
}
