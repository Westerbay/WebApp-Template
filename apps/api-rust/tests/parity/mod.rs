use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use better_auth::{
    prelude::AuthSession,
    seaorm::sea_orm::{ActiveModelTrait, Set},
};
use chrono::{Duration, Utc};
use serde_json::{Value, json};
use tower::ServiceExt;
use url::Url;
use webapp_api::infrastructure::database::schema;
use webapp_api::{Application, config::auth as settings};

const PASSWORD: &str = "Local-Application-2026!";

use crate::support::fixture;

async fn call(
    app: &Application,
    path: &str,
    body: Option<Value>,
    cookie: &str,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let mut request = Request::builder()
        .uri(path)
        .method(if body.is_some() { "POST" } else { "GET" })
        .header("origin", settings::WEB_ORIGIN)
        .header("content-type", "application/json");
    if !cookie.is_empty() {
        request = request.header("cookie", cookie);
    }
    let response = app
        .router
        .clone()
        .oneshot(
            request
                .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    let bytes = to_bytes(body, 1024 * 1024).await.unwrap();
    (
        parts.status,
        parts.headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn signup(app: &Application, password: &str) {
    let (status, _, body) = call(app, "/api/auth/sign-up/email", Some(json!({"name":"Alice", "email":"alice@example.test", "password":password, "callbackURL":format!("{}/email-verified", settings::WEB_ORIGIN)})), "").await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

async fn verify(app: &Application) {
    let mail = app
        .mailbox
        .messages()
        .await
        .into_iter()
        .find(|mail| mail.kind == "verification")
        .unwrap();
    let url = Url::parse(&mail.url).unwrap();
    let (status, headers, _) = call(
        app,
        &format!("{}?{}", url.path(), url.query().unwrap()),
        None,
        "",
    )
    .await;
    assert_eq!(status, StatusCode::FOUND);
    assert!(
        headers.get("set-cookie").is_none(),
        "verification must not log in"
    );
    assert_eq!(
        headers["location"],
        format!("{}/email-verified", settings::WEB_ORIGIN)
    );
}

async fn login(app: &Application, password: &str) -> (String, String) {
    let (status, headers, body) = call(
        app,
        "/api/auth/sign-in/email",
        Some(json!({"email":"alice@example.test", "password":password})),
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let set_cookie = headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|header| header.to_str().ok())
        .find(|value| value.contains("session_token="))
        .unwrap();
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("SameSite=Lax"));
    (
        set_cookie.split(';').next().unwrap().into(),
        body["token"].as_str().unwrap().into(),
    )
}

async fn request_reset(app: &Application) -> String {
    let (status, _, body) = call(app, "/api/auth/request-password-reset", Some(json!({"email":"alice@example.test", "redirectTo":format!("{}/fr/reset-password", settings::WEB_ORIGIN)})), "").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let mail = app
        .mailbox
        .messages()
        .await
        .into_iter()
        .rev()
        .find(|mail| mail.kind == "reset")
        .unwrap();
    assert_eq!(mail.locale, "fr");
    let url = Url::parse(&mail.url).unwrap();
    let (_, headers, _) = call(
        app,
        &format!("{}?{}", url.path(), url.query().unwrap()),
        None,
        "",
    )
    .await;
    let redirect = Url::parse(headers["location"].to_str().unwrap()).unwrap();
    assert_eq!(redirect.path(), "/fr/reset-password");
    let token = redirect
        .query_pairs()
        .find(|(key, _)| key == "token")
        .unwrap()
        .1
        .into_owned();
    let verification = app
        .auth
        .store()
        .get_verification_by_identifier(&format!("reset-password:{token}"))
        .await
        .unwrap()
        .unwrap();
    assert!(
        (verification.expires_at - Utc::now() - Duration::hours(1))
            .num_seconds()
            .abs()
            < 5
    );
    token
}

mod passwords;
mod requests;
mod sessions;
mod signup;
mod users;
