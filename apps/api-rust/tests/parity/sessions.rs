use super::*;

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
