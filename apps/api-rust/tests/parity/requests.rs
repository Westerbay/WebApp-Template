use super::*;

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
