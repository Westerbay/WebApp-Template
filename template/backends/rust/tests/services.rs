use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Path, State},
    http::{Request, StatusCode},
    response::IntoResponse,
    routing::get,
};
use better_auth::seaorm::sea_orm::{ConnectionTrait, Statement};
use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use std::sync::{
    Arc,
    atomic::{AtomicU8, Ordering},
};
use tokio::sync::Mutex;
use tower::ServiceExt;
use url::Url;
use webapp_api::{
    Application, AuthServices,
    config::email::{EmailMode, SmtpSettings},
    config::{auth as settings, environment::Environment},
    infrastructure::auth::hibp::PasswordCheck,
    infrastructure::email::mail::Mailbox,
    infrastructure::email::smtp::SmtpSender,
    infrastructure::rate_limit::store::SharedQuotas,
};
mod support;

const PASSWORD: &str = "Local-Application-2026!";
const COMPROMISED: &str = "Compromised-2026!";

async fn call(
    app: &Application,
    path: &str,
    body: Option<Value>,
    cookie: &str,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let request = Request::builder()
        .uri(path)
        .method(if body.is_some() { "POST" } else { "GET" })
        .header("origin", settings::WEB_ORIGIN)
        .header("content-type", "application/json")
        .header("cookie", cookie)
        .body(Body::from(
            body.map(|value| value.to_string()).unwrap_or_default(),
        ))
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let (parts, body) = response.into_parts();
    let bytes = to_bytes(body, 1024 * 1024).await.unwrap();
    (
        parts.status,
        parts.headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn configured(check: PasswordCheck, mailbox: Mailbox) -> Application {
    let config = settings::local();
    let base = support::fixture(config.clone()).await;
    Application::connect(
        config,
        base.database,
        AuthServices {
            password_check: check,
            mailbox,
        },
    )
    .await
    .unwrap()
}

async fn signup(app: &Application, email: &str, password: &str) -> (StatusCode, Value) {
    let (status,_,body) = call(app,"/api/auth/sign-up/email",Some(json!({"email":email,"name":"Alice","password":password,"callbackURL":format!("{}/email-verified",settings::WEB_ORIGIN)})),"").await;
    (status, body)
}

async fn verify_and_login(app: &Application) -> String {
    assert_eq!(
        signup(app, "alice@example.test", PASSWORD).await.0,
        StatusCode::OK
    );
    let messages = app.mailbox.messages().await;
    let url = Url::parse(&messages[0].url).unwrap();
    assert_eq!(
        call(
            app,
            &format!("{}?{}", url.path(), url.query().unwrap()),
            None,
            ""
        )
        .await
        .0,
        StatusCode::FOUND
    );
    let (status, headers, _) = call(
        app,
        "/api/auth/sign-in/email",
        Some(json!({"email":"alice@example.test","password":PASSWORD})),
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find(|value| value.contains("session_token="))
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .into()
}

async fn reset_token(app: &Application) -> String {
    assert_eq!(call(app,"/api/auth/request-password-reset",Some(json!({"email":"alice@example.test","redirectTo":format!("{}/reset-password",settings::WEB_ORIGIN)})),"").await.0,StatusCode::OK);
    let messages = app.mailbox.messages().await;
    let url = Url::parse(&messages.last().unwrap().url).unwrap();
    url.path_segments().unwrap().next_back().unwrap().into()
}

#[derive(Clone)]
struct Probe {
    mode: Arc<AtomicU8>,
    requests: Arc<Mutex<Vec<(String, bool)>>>,
    suffix: String,
}
struct HibpFixture {
    check: PasswordCheck,
    probe: Probe,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for HibpFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn hibp_fixture() -> HibpFixture {
    async fn range(
        State(probe): State<Probe>,
        Path(prefix): Path<String>,
        request: Request<Body>,
    ) -> axum::response::Response {
        let padding = request
            .headers()
            .get("add-padding")
            .is_some_and(|value| value == "true");
        assert!(request.uri().query().is_none());
        assert_eq!(prefix.len(), 5);
        assert!(prefix.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert!(
            to_bytes(request.into_body(), 1024)
                .await
                .unwrap()
                .is_empty()
        );
        probe.requests.lock().await.push((prefix, padding));
        let mode = probe.mode.load(Ordering::SeqCst);
        if mode == 3 {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        if mode == 6 {
            return (
                StatusCode::TEMPORARY_REDIRECT,
                [("Location", "http://127.0.0.1:1/")],
                format!("{}:0", probe.suffix),
            )
                .into_response();
        }
        if mode == 5 {
            tokio::time::sleep(std::time::Duration::from_secs(6)).await;
        }
        let text = match mode {
            1 => format!("{}:12\r\n{}:0", probe.suffix, "0".repeat(35)),
            2 => "invalid-provider-payload".into(),
            4 => format!("{}:0", probe.suffix),
            _ => format!("{}:0", "0".repeat(35)),
        };
        text.into_response()
    }
    let digest = format!("{:X}", Sha1::digest(COMPROMISED.as_bytes()));
    let probe = Probe {
        mode: Arc::new(AtomicU8::new(0)),
        requests: Arc::default(),
        suffix: digest[5..].into(),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint =
        Url::parse(&format!("http://{}/range/", listener.local_addr().unwrap())).unwrap();
    let router = Router::new()
        .route("/range/{prefix}", get(range))
        .with_state(probe.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    HibpFixture {
        check: PasswordCheck::local_fixture(endpoint).unwrap(),
        probe,
        task,
    }
}

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

#[tokio::test]
async fn quota_admission_is_shared_between_replicas_and_denials_do_not_extend_the_window() {
    let config = settings::local();
    let first = support::fixture(config.clone()).await;
    let second = Application::connect(
        config,
        first.database.clone(),
        AuthServices::configured(Mailbox::default()).unwrap(),
    )
    .await
    .unwrap();
    let mut tasks = Vec::new();
    for index in 0..12 {
        let router = if index % 2 == 0 {
            first.router.clone()
        } else {
            second.router.clone()
        };
        tasks.push(tokio::spawn(async move {
            router
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/auth/send-verification-email")
                        .header("origin", settings::WEB_ORIGIN)
                        .header("content-type", "application/json")
                        .header("x-forwarded-for", format!("192.0.2.{index}"))
                        .extension(axum::extract::ConnectInfo(
                            "127.0.0.1:12345".parse::<std::net::SocketAddr>().unwrap(),
                        ))
                        .body(Body::from(r#"{"email":"unknown@example.test"}"#))
                        .unwrap(),
                )
                .await
                .unwrap()
                .status()
        }));
    }
    let mut allowed = 0;
    for task in tasks {
        let status = task.await.unwrap();
        if status == StatusCode::OK {
            allowed += 1;
        } else {
            assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        }
    }
    assert_eq!(allowed, 5);
    let quotas = SharedQuotas(first.database.clone());
    assert_eq!(quotas.consume("window-test", 1, 60).await.unwrap(), None);
    let backend = first.database.get_database_backend();
    let before = first
        .database
        .query_one_raw(Statement::from_sql_and_values(
            backend,
            "SELECT last_request FROM auth_rate_limits WHERE key=$1",
            ["window-test".into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "last_request")
        .unwrap();
    assert!(
        quotas
            .consume("window-test", 1, 60)
            .await
            .unwrap()
            .is_some()
    );
    let after = first
        .database
        .query_one_raw(Statement::from_sql_and_values(
            backend,
            "SELECT last_request FROM auth_rate_limits WHERE key=$1",
            ["window-test".into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "last_request")
        .unwrap();
    assert_eq!(before, after);
    first
        .database
        .execute_raw(Statement::from_sql_and_values(
            backend,
            "UPDATE auth_rate_limits SET last_request=$1 WHERE key=$2",
            [(before - 60_000).into(), "window-test".into()],
        ))
        .await
        .unwrap();
    assert_eq!(quotas.consume("window-test", 1, 60).await.unwrap(), None);
}

#[tokio::test]
async fn unavailable_shared_quotas_reject_auth_and_private_identity() {
    let app = support::fixture(settings::local()).await;
    app.database
        .execute_unprepared("DROP TABLE auth_rate_limits")
        .await
        .unwrap();
    assert_eq!(
        signup(&app, "alice@example.test", PASSWORD).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        call(&app, "/api/me", None, "").await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[tokio::test]
async fn private_identity_and_general_auth_keep_their_distinct_shared_quotas() {
    let app = support::fixture(settings::local()).await;
    for _ in 0..30 {
        assert_eq!(
            call(&app, "/api/me", None, "").await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    let (status, headers, _) = call(&app, "/api/me", None, "").await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(
        headers["retry-after"]
            .to_str()
            .unwrap()
            .parse::<u64>()
            .unwrap()
            > 0
    );
    for _ in 0..100 {
        assert_eq!(
            call(&app, "/api/auth/get-session", None, "").await.0,
            StatusCode::OK
        );
    }
    assert_eq!(
        call(&app, "/api/auth/get-session", None, "").await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
}

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
