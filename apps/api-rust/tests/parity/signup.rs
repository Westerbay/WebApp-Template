use super::*;

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
