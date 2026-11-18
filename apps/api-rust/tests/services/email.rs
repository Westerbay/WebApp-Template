use super::*;

#[tokio::test]
async fn smtp_delivers_localized_html_and_text_via_mailpit_and_preserves_action_urls() {
    let mailbox = Mailbox::new(
        settings::WEB_ORIGIN,
        "en",
        SmtpSettings::capture("mailpit", 1025),
    )
    .unwrap();
    let app = configured(PasswordCheck::Offline, mailbox).await;
    let email = format!("smtp-{}@example.test", rand::random::<u64>());
    let callback = format!(
        "{}/fr/adresse-confirmee?source=test&return=account",
        settings::WEB_ORIGIN
    );
    assert_eq!(
        call(
            &app,
            "/api/auth/sign-up/email",
            Some(json!({"email":email,"name":"Alice","password":PASSWORD,"callbackURL":callback})),
            ""
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(call(&app,"/api/auth/request-password-reset",Some(json!({"email":email,"redirectTo":format!("{}/en/reset-password",settings::WEB_ORIGIN)})),"").await.0,StatusCode::OK);
    app.mailbox.drain().await.unwrap();
    let captured = app.mailbox.messages().await;
    assert_eq!(captured.len(), 2);
    let client = reqwest::Client::new();
    let listing: Value = client
        .get("http://mailpit:8025/api/v1/messages")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let messages = listing["messages"].as_array().unwrap();
    for mail in &captured {
        let row = messages
            .iter()
            .find(|row| {
                row["To"]
                    .as_array()
                    .is_some_and(|to| to.iter().any(|to| to["Address"] == email))
                    && row["Subject"] == mail.subject
            })
            .unwrap();
        let id = row["ID"].as_str().unwrap();
        let message: Value = client
            .get(format!("http://mailpit:8025/api/v1/message/{id}"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(message["Text"].as_str().unwrap().contains(&mail.url));
        assert!(
            message["HTML"]
                .as_str()
                .unwrap()
                .contains(&format!("lang=\"{}\"", mail.locale))
        );
        if mail.kind == "verification" {
            assert!(message["HTML"].as_str().unwrap().contains("&amp;"));
        }
        assert_eq!(message["Subject"], mail.subject);
    }
    assert_eq!(captured[0].subject, "Confirmez votre adresse email");
    assert!(captured[0].text.contains("24 heures"));
    assert_eq!(captured[1].subject, "Reset your password");
    assert!(captured[1].text.contains("1 hour."));
}

#[tokio::test]
async fn smtp_outage_is_visible_but_does_not_change_non_enumerating_acceptance() {
    let mailbox = Mailbox::new(
        settings::WEB_ORIGIN,
        "en",
        SmtpSettings::capture("127.0.0.1", 1),
    )
    .unwrap();
    let app = configured(PasswordCheck::Offline, mailbox).await;
    assert_eq!(
        signup(&app, "alice@example.test", PASSWORD).await.0,
        StatusCode::OK
    );
    assert!(app.mailbox.drain().await.is_err());
    let known = call(
        &app,
        "/api/auth/request-password-reset",
        Some(json!({"email":"alice@example.test"})),
        "",
    )
    .await;
    let unknown = call(
        &app,
        "/api/auth/request-password-reset",
        Some(json!({"email":"unknown@example.test"})),
        "",
    )
    .await;
    assert_eq!((known.0, known.2), (unknown.0, unknown.2));
    assert!(app.mailbox.drain().await.is_err());
}

#[tokio::test]
async fn staging_recipient_allowlist_is_exact_and_transport_configuration_is_strict() {
    let app = support::fixture(settings::local()).await;
    signup(&app, "alice@example.test", PASSWORD).await;
    let mail = app.mailbox.messages().await.remove(0);
    let mut config = SmtpSettings::capture("127.0.0.1", 1);
    config.environment = Environment::Staging;
    config.mode = EmailMode::Smtp;
    config.allowed_recipients = vec!["other@example.test".into()];
    assert_eq!(
        SmtpSender::new(config.clone()).unwrap().send(&mail).await,
        Err("EMAIL_RECIPIENT_NOT_ALLOWED")
    );
    config.allowed_recipients.clear();
    assert!(config.validate().is_err());
    config.environment = Environment::Test;
    assert!(config.validate().is_err());
    config.environment = Environment::Production;
    assert!(config.validate().is_err());
    config.username = Some("fixture".into());
    config.password = Some("fixture-only".into());
    assert!(config.validate().is_ok());
    config.mode = EmailMode::Capture;
    assert!(config.validate().is_err());
    config.environment = Environment::Test;
    config.host = "smtp.example.test".into();
    assert!(config.validate().is_err());
}
