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
use webapp_api::schema;
use webapp_api::{Application, settings};

const PASSWORD: &str = "Local-Application-2026!";

mod support;
use support::fixture;

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

#[tokio::test]
async fn signup_sends_localized_verification_without_creating_a_session() {
    let app = fixture(settings::local()).await;
    let (status, headers, body) = call(&app, "/api/auth/sign-up/email", Some(json!({"name":"Alice", "email":"alice@example.test", "password":PASSWORD, "callbackURL":format!("{}/fr/email-verified", settings::WEB_ORIGIN)})), "").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(headers.get("set-cookie").is_none());
    assert!(body["token"].is_null());
    assert_eq!(
        call(&app, "/api/me", None, "").await.0,
        StatusCode::UNAUTHORIZED
    );
    let mails = app.mailbox.messages().await;
    assert_eq!(
        mails.len(),
        1,
        "signup must automatically send verification"
    );
    assert_eq!(mails[0].locale, "fr");
}

#[tokio::test]
async fn duplicate_signup_is_opaque_without_changing_identity_or_sending_mail() {
    let app = fixture(settings::local()).await;
    signup(&app, PASSWORD).await;
    verify(&app).await;
    let original = app
        .auth
        .store()
        .get_user_by_email("alice@example.test")
        .await
        .unwrap()
        .unwrap();
    let mails = app.mailbox.messages().await.len();
    let (status, headers, body) = call(&app, "/api/auth/sign-up/email", Some(json!({
        "name":"Submitted Name", "email":"ALICE@example.test", "password":" Different-Password-2026! ",
        "callbackURL":format!("{}/email-verified", settings::WEB_ORIGIN)
    })), "").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(headers.get("set-cookie").is_none());
    assert!(body["token"].is_null());
    assert_eq!(body["user"]["name"], "Submitted Name");
    assert_eq!(body["user"]["email"], "alice@example.test");
    assert_eq!(body["user"]["emailVerified"], false);
    assert_ne!(body["user"]["id"], original.id);
    assert_eq!(app.mailbox.messages().await.len(), mails);
    assert_eq!(
        app.auth
            .store()
            .get_user_by_email("alice@example.test")
            .await
            .unwrap()
            .unwrap()
            .name,
        original.name
    );
    login(&app, PASSWORD).await;
}

#[tokio::test]
async fn duplicate_signup_keeps_upstream_password_and_email_validation() {
    let app = fixture(settings::local()).await;
    signup(&app, PASSWORD).await;
    for password in [
        "short".to_owned(),
        "x".repeat(settings::PASSWORD_MAX_LENGTH + 1),
    ] {
        let mut outcomes = Vec::new();
        for email in ["alice@example.test", "unknown@example.test"] {
            let (status, headers, body) = call(
                &app,
                "/api/auth/sign-up/email",
                Some(json!({
                    "name":"Alice", "email":email, "password":password
                })),
                "",
            )
            .await;
            assert!(status.is_client_error(), "{body}");
            assert!(headers.get("set-cookie").is_none());
            outcomes.push((status, body));
        }
        assert_eq!(outcomes[0], outcomes[1]);
    }
    // A fresh app avoids the deliberately small signup quota.
    let app = fixture(settings::local()).await;
    let (status, _, _) = call(
        &app,
        "/api/auth/sign-up/email",
        Some(json!({
            "name":"Alice", "email":"invalid-email", "password":PASSWORD
        })),
        "",
    )
    .await;
    assert!(status.is_client_error());
    assert!(app.mailbox.messages().await.is_empty());
}

#[tokio::test]
async fn concurrent_duplicate_signup_succeeds_without_extra_identity_or_mail() {
    let app = fixture(settings::local()).await;
    let body = json!({"name":"Alice", "email":"alice@example.test", "password":PASSWORD});
    let (first, second) = tokio::join!(
        call(&app, "/api/auth/sign-up/email", Some(body.clone()), ""),
        call(&app, "/api/auth/sign-up/email", Some(body), "")
    );
    for (status, headers, body) in [first, second] {
        assert_eq!(status, StatusCode::OK, "{body}");
        assert!(headers.get("set-cookie").is_none());
        assert!(body["token"].is_null());
    }
    assert_eq!(app.mailbox.messages().await.len(), 1);
    let user = app
        .auth
        .store()
        .get_user_by_email("alice@example.test")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        app.auth
            .store()
            .get_user_accounts(&user.id)
            .await
            .unwrap()
            .len(),
        1
    );
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

#[tokio::test]
async fn session_cookies_identity_and_signout_match_the_template() {
    let app = fixture(settings::local()).await;
    signup(&app, PASSWORD).await;
    verify(&app).await;
    let (cookie, token) = login(&app, PASSWORD).await;
    let (status, _, body) = call(&app, "/api/me", None, &cookie).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["email"], "alice@example.test");
    assert_eq!(body["emailVerified"], true);
    assert_eq!(
        body.as_object().unwrap().len(),
        4,
        "identity must not expose provider/session fields"
    );
    let session = app.auth.store().get_session(&token).await.unwrap().unwrap();
    assert!(
        (session.expires_at() - Utc::now() - Duration::days(7))
            .num_seconds()
            .abs()
            < 5
    );
    assert_eq!(
        call(&app, "/api/auth/sign-out", Some(json!({})), &cookie)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "/api/me", None, &cookie).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn reset_is_single_use_revokes_every_session_and_preserves_exact_passwords() {
    let app = fixture(settings::local()).await;
    signup(&app, PASSWORD).await;
    verify(&app).await;
    let (first, _) = login(&app, PASSWORD).await;
    let (second, _) = login(&app, PASSWORD).await;
    let token = request_reset(&app).await;
    let password = "  Ａ-local-new-password  ";
    let (status, headers, body) = call(
        &app,
        "/api/auth/reset-password",
        Some(json!({"token":token, "newPassword":password})),
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(headers.get("set-cookie").is_none());
    assert_eq!(
        call(
            &app,
            "/api/auth/reset-password",
            Some(json!({"token":token, "newPassword":PASSWORD})),
            ""
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    for cookie in [first, second] {
        assert_eq!(
            call(&app, "/api/me", None, &cookie).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    for wrong in [PASSWORD, "  A-local-new-password  "] {
        assert_eq!(
            call(
                &app,
                "/api/auth/sign-in/email",
                Some(json!({"email":"alice@example.test", "password":wrong})),
                ""
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
    login(&app, password).await;
}

#[tokio::test]
async fn email_requests_do_not_reveal_account_existence() {
    let app = fixture(settings::local()).await;
    signup(&app, PASSWORD).await;
    for path in [
        "/api/auth/request-password-reset",
        "/api/auth/send-verification-email",
    ] {
        let known = call(&app, path, Some(json!({"email":"alice@example.test"})), "").await;
        let unknown = call(
            &app,
            path,
            Some(json!({"email":"unknown@example.test"})),
            "",
        )
        .await;
        assert_eq!(known.0, StatusCode::OK);
        assert_eq!(known.0, unknown.0);
        assert_eq!(known.2, unknown.2);
    }
}

#[tokio::test]
async fn hostile_origins_callbacks_and_unsigned_cookies_are_rejected() {
    let app = fixture(settings::local()).await;
    signup(&app, PASSWORD).await;
    verify(&app).await;
    let (cookie, token) = login(&app, PASSWORD).await;
    for origin in ["https://evil.test", "null", ""] {
        let request = Request::builder()
            .uri("/api/auth/sign-out")
            .method("POST")
            .header("cookie", &cookie)
            .header("origin", origin)
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .unwrap();
        assert_eq!(
            app.router.clone().oneshot(request).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }
    for field in ["redirectTo", "callbackURL"] {
        let path = if field == "redirectTo" {
            "/api/auth/request-password-reset"
        } else {
            "/api/auth/send-verification-email"
        };
        assert_eq!(
            call(
                &app,
                path,
                Some(json!({"email":"alice@example.test", (field):"https://evil.test/reset"})),
                ""
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        call(
            &app,
            "/api/me",
            None,
            &format!("better-auth.session_token={token}")
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(call(&app, "/api/me", None, &cookie).await.0, StatusCode::OK);
}

#[tokio::test]
async fn sensitive_quota_cannot_be_bypassed_with_forwarded_headers() {
    let app = fixture(settings::local()).await;
    let mut responses = Vec::new();
    for index in 0..8 {
        let app = app.router.clone();
        responses.push(tokio::spawn(async move {
            let request = Request::builder()
                .uri("/api/auth/send-verification-email")
                .method("POST")
                .header("content-type", "application/json")
                .header("origin", settings::WEB_ORIGIN)
                .header("x-forwarded-for", format!("192.0.2.{index}"))
                .header("x-real-ip", format!("198.51.100.{index}"))
                .extension(axum::extract::ConnectInfo(
                    "127.0.0.1:12345".parse::<std::net::SocketAddr>().unwrap(),
                ))
                .body(Body::from(r#"{"email":"unknown@example.test"}"#))
                .unwrap();
            app.oneshot(request).await.unwrap().status()
        }));
    }
    let mut allowed = 0;
    let mut limited = 0;
    for response in responses {
        match response.await.unwrap() {
            StatusCode::OK => allowed += 1,
            StatusCode::TOO_MANY_REQUESTS => limited += 1,
            status => panic!("Unexpected status: {status}"),
        }
    }
    assert_eq!((allowed, limited), (5, 3));
}

#[tokio::test]
async fn expired_sessions_and_reset_tokens_are_rejected() {
    let app = fixture(settings::local()).await;
    signup(&app, PASSWORD).await;
    verify(&app).await;
    let (cookie, token) = login(&app, PASSWORD).await;
    app.auth
        .store()
        .update_session_expiry(&token, Utc::now() - Duration::seconds(1))
        .await
        .unwrap();
    assert_eq!(
        call(&app, "/api/me", None, &cookie).await.0,
        StatusCode::UNAUTHORIZED
    );
    let token = request_reset(&app).await;
    let verification = app
        .auth
        .store()
        .get_verification_by_identifier(&format!("reset-password:{token}"))
        .await
        .unwrap()
        .unwrap();
    let mut expired: schema::verification::ActiveModel = verification.into();
    expired.expires_at = Set(Utc::now() - Duration::seconds(1));
    expired.update(&app.database).await.unwrap();
    assert_eq!(
        call(
            &app,
            "/api/auth/reset-password",
            Some(json!({"token":token, "newPassword":PASSWORD})),
            ""
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn sessions_renew_only_after_the_configured_age() {
    let app = fixture(settings::local()).await;
    signup(&app, PASSWORD).await;
    verify(&app).await;
    let (cookie, token) = login(&app, PASSWORD).await;
    let initial = app.auth.store().get_session(&token).await.unwrap().unwrap();
    call(&app, "/api/auth/get-session", None, &cookie).await;
    assert_eq!(
        initial.expires_at,
        app.auth
            .store()
            .get_session(&token)
            .await
            .unwrap()
            .unwrap()
            .expires_at
    );
    let stale_expiry = Utc::now() + Duration::days(5);
    app.auth
        .store()
        .update_session_expiry(&token, stale_expiry)
        .await
        .unwrap();
    let (status, headers, _) = call(&app, "/api/auth/get-session", None, &cookie).await;
    assert_eq!(status, StatusCode::OK);
    assert!(headers.get("set-cookie").is_some());
    assert!(
        app.auth
            .store()
            .get_session(&token)
            .await
            .unwrap()
            .unwrap()
            .expires_at
            > stale_expiry + Duration::days(1)
    );
}

#[tokio::test]
async fn password_length_limits_and_unicode_composition_are_preserved() {
    for password in ["short".into(), "a".repeat(129)] {
        let app = fixture(settings::local()).await;
        assert_eq!(
            call(
                &app,
                "/api/auth/sign-up/email",
                Some(json!({"name":"Alice", "email":"alice@example.test", "password":password})),
                ""
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        assert!(app.mailbox.messages().await.is_empty());
    }
    let app = fixture(settings::local()).await;
    let password = "e\u{301}-password  ";
    signup(&app, password).await;
    verify(&app).await;
    assert_eq!(
        call(
            &app,
            "/api/auth/sign-in/email",
            Some(json!({"email":"alice@example.test", "password":"é-password  "})),
            ""
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    login(&app, password).await;
}

#[tokio::test]
async fn concurrent_reset_attempts_accept_only_one_writer() {
    let app = fixture(settings::local()).await;
    signup(&app, PASSWORD).await;
    verify(&app).await;
    let token = request_reset(&app).await;
    let (first, second) = tokio::join!(
        call(
            &app,
            "/api/auth/reset-password",
            Some(json!({"token":token, "newPassword":"First-Local-Password"})),
            ""
        ),
        call(
            &app,
            "/api/auth/reset-password",
            Some(json!({"token":token, "newPassword":"Second-Local-Password"})),
            ""
        )
    );
    let mut statuses = [first.0.as_u16(), second.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 400]);
}

#[tokio::test]
async fn https_configuration_sets_secure_session_cookies() {
    let config = settings::local().base_url("https://api.example.test/api/auth");
    let app = fixture(config).await;
    signup(&app, PASSWORD).await;
    verify(&app).await;
    let (_, headers, _) = call(
        &app,
        "/api/auth/sign-in/email",
        Some(json!({"email":"alice@example.test", "password":PASSWORD})),
        "",
    )
    .await;
    let cookie = headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|header| header.to_str().ok())
        .find(|value| value.contains("session_token="))
        .unwrap();
    assert!(cookie.contains("Secure"));
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Lax"));
}

#[tokio::test]
async fn application_openapi_describes_the_actual_identity_response() {
    let app = fixture(settings::local()).await;
    let (status, _, document) = call(&app, "/openapi.json", None, "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        document["paths"]["/api/me"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
            ["$ref"],
        "#/components/schemas/CurrentUser"
    );
    let properties = &document["components"]["schemas"]["CurrentUser"]["properties"];
    assert_eq!(properties["emailVerified"]["type"], "boolean");
    assert_eq!(properties.as_object().unwrap().len(), 4);
}

#[tokio::test]
async fn existing_frontend_users_contract_keeps_pagination_search_and_access_checks() {
    use better_auth::prelude::CreateUser;
    let app = fixture(settings::local()).await;
    assert_eq!(
        call(&app, "/api/users", None, "").await.0,
        StatusCode::UNAUTHORIZED
    );
    signup(&app, PASSWORD).await;
    verify(&app).await;
    let (cookie, _) = login(&app, PASSWORD).await;
    for (email, name) in [
        ("percent@example.test", "Literal%Name"),
        ("underscore@example.test", "Literal_Name"),
        ("mixed@example.test", "MiXeD"),
    ] {
        app.auth
            .store()
            .create_user(CreateUser::new().with_email(email).with_name(name))
            .await
            .unwrap();
    }
    let (status, _, body) = call(&app, "/api/users?limit=1", None, &cookie).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["items"].as_array().unwrap().len(), 1);
    let cursor = body["nextCursor"].as_str().unwrap();
    let next = call(
        &app,
        &format!("/api/users?limit=1&cursor={cursor}"),
        None,
        &cookie,
    )
    .await
    .2;
    assert_ne!(body["items"][0]["id"], next["items"][0]["id"]);
    for (search, name) in [
        ("%25", "Literal%Name"),
        ("_", "Literal_Name"),
        ("mixed", "MiXeD"),
    ] {
        let (status, _, body) =
            call(&app, &format!("/api/users?search={search}"), None, &cookie).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["items"].as_array().unwrap().len(), 1);
        assert_eq!(body["items"][0]["name"], name);
        assert!(body["nextCursor"].is_null());
    }
    assert_eq!(
        call(&app, "/api/users?limit=101", None, &cookie).await.0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn password_boundaries_do_not_introduce_character_class_requirements() {
    for length in [8, 128] {
        let app = fixture(settings::local()).await;
        let password = "a".repeat(length);
        signup(&app, &password).await;
        verify(&app).await;
        login(&app, &password).await;
    }
}
