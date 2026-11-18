use crate::support;
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

mod email;
mod passwords;
mod quotas;
