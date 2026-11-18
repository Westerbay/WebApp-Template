use super::*;

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
async fn password_boundaries_do_not_introduce_character_class_requirements() {
    for length in [8, 128] {
        let app = fixture(settings::local()).await;
        let password = "a".repeat(length);
        signup(&app, &password).await;
        verify(&app).await;
        login(&app, &password).await;
    }
}
