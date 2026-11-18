use super::*;

#[tokio::test]
async fn duplicate_signup_performs_password_checks_without_mutating_the_account() {
    let fixture = hibp_fixture().await;
    let app = configured(fixture.check.clone(), Mailbox::default()).await;
    assert_eq!(
        signup(&app, "alice@example.test", PASSWORD).await.0,
        StatusCode::OK
    );
    assert_eq!(
        signup(&app, "alice@example.test", PASSWORD).await.0,
        StatusCode::OK
    );
    fixture.probe.mode.store(1, Ordering::SeqCst);
    let (status, body) = signup(&app, "alice@example.test", COMPROMISED).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "PASSWORD_COMPROMISED");
    fixture.probe.mode.store(3, Ordering::SeqCst);
    assert_eq!(
        signup(&app, "alice@example.test", PASSWORD).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(fixture.probe.requests.lock().await.len(), 4);
    assert_eq!(app.mailbox.messages().await.len(), 1);
    fixture.task.abort();
}

#[tokio::test]
async fn hibp_rejects_compromised_signup_without_creating_an_account_and_sends_only_prefix() {
    let fixture = hibp_fixture().await;
    fixture.probe.mode.store(1, Ordering::SeqCst);
    let app = configured(fixture.check.clone(), Mailbox::default()).await;
    let (status, body) = signup(&app, "alice@example.test", COMPROMISED).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "PASSWORD_COMPROMISED");
    assert!(
        app.auth
            .store()
            .get_user_by_email("alice@example.test")
            .await
            .unwrap()
            .is_none()
    );
    assert!(app.mailbox.messages().await.is_empty());
    let requests = fixture.probe.requests.lock().await;
    assert_eq!(requests.len(), 1);
    assert!(requests[0].1);
    assert_eq!(
        requests[0].0,
        format!("{:X}", Sha1::digest(COMPROMISED.as_bytes()))[..5]
    );
}

#[tokio::test]
async fn hibp_reset_refusal_and_outage_consume_links_without_changing_password_or_sessions() {
    let fixture = hibp_fixture().await;
    let app = configured(fixture.check.clone(), Mailbox::default()).await;
    let cookie = verify_and_login(&app).await;
    for mode in [1, 3] {
        let token = reset_token(&app).await;
        fixture.probe.mode.store(mode, Ordering::SeqCst);
        let (status, _, body) = call(
            &app,
            "/api/auth/reset-password",
            Some(json!({"token":token,"newPassword":COMPROMISED})),
            "",
        )
        .await;
        assert_eq!(
            status,
            if mode == 1 {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            },
            "{body}"
        );
        fixture.probe.mode.store(0, Ordering::SeqCst);
        assert_eq!(
            call(
                &app,
                "/api/auth/reset-password",
                Some(json!({"token":token,"newPassword":"Fresh-Password-2026!"})),
                ""
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(call(&app, "/api/me", None, &cookie).await.0, StatusCode::OK);
    }
    fixture.probe.mode.store(3, Ordering::SeqCst);
    let before = fixture.probe.requests.lock().await.len();
    assert_eq!(
        call(
            &app,
            "/api/auth/sign-in/email",
            Some(json!({"email":"alice@example.test","password":PASSWORD})),
            ""
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        fixture.probe.requests.lock().await.len(),
        before,
        "signin must never call HIBP"
    );
}

#[tokio::test]
async fn hibp_padding_is_not_a_breach_and_provider_corruption_and_timeout_fail_closed() {
    let fixture = hibp_fixture().await;
    fixture.probe.mode.store(4, Ordering::SeqCst);
    assert!(fixture.check.validate(COMPROMISED).await.is_ok());
    for mode in [2, 3, 5, 6] {
        fixture.probe.mode.store(mode, Ordering::SeqCst);
        assert_eq!(
            fixture
                .check
                .validate(COMPROMISED)
                .await
                .unwrap_err()
                .status_code(),
            503
        );
    }
}

#[tokio::test]
async fn environment_enables_hibp_only_for_staging_and_production() {
    for (environment, enabled) in [
        (Environment::Development, false),
        (Environment::Test, false),
        (Environment::Staging, true),
        (Environment::Production, true),
    ] {
        let mut smtp = SmtpSettings::capture("mailpit", 1025);
        smtp.environment = environment;
        if environment == Environment::Production {
            smtp.mode = EmailMode::Smtp;
            smtp.username = Some("fixture".into());
            smtp.password = Some("fixture-only".into());
        }
        let mailbox = Mailbox::new(settings::WEB_ORIGIN, "en", smtp).unwrap();
        let services = AuthServices::configured(mailbox).unwrap();
        assert_eq!(
            !matches!(services.password_check, PasswordCheck::Offline),
            enabled
        );
    }
}
