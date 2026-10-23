use better_auth::{AuthError, AuthResult};
use reqwest::{Client, redirect::Policy};
use sha1::{Digest, Sha1};
use std::time::Duration;
use url::Url;

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Default)]
pub enum PasswordCheck {
    #[default]
    Offline,
    Hibp {
        client: Client,
        endpoint: Url,
    },
}

impl PasswordCheck {
    pub fn enabled() -> AuthResult<Self> {
        Self::client(
            Url::parse("https://api.pwnedpasswords.com/range/")
                .map_err(|_| AuthError::config("Invalid HIBP endpoint"))?,
        )
    }

    /// Offline integration tests exercise the real HTTP adapter on loopback.
    pub fn local_fixture(endpoint: Url) -> AuthResult<Self> {
        if !matches!(endpoint.host_str(), Some("127.0.0.1" | "localhost" | "::1")) {
            return Err(AuthError::config("HIBP fixtures must be loopback-only"));
        }
        Self::client(endpoint)
    }

    fn client(endpoint: Url) -> AuthResult<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(Policy::none())
            .user_agent("WebApp-Template-Rust-Auth")
            .build()
            .map_err(|_| AuthError::config("HIBP client initialization failed"))?;
        Ok(Self::Hibp { client, endpoint })
    }

    pub async fn validate(&self, password: &str) -> AuthResult<()> {
        let Self::Hibp { client, endpoint } = self else {
            return Ok(());
        };
        let digest = format!("{:X}", Sha1::digest(password.as_bytes()));
        let (prefix, suffix) = digest.split_at(5);
        let url = endpoint.join(prefix).map_err(|_| unavailable())?;
        let mut response = client
            .get(url)
            .header("Add-Padding", "true")
            .send()
            .await
            .map_err(|_| unavailable())?
            .error_for_status()
            .map_err(|_| unavailable())?;
        let mut bytes = Vec::new();
        if response.status() != reqwest::StatusCode::OK {
            return Err(unavailable());
        }
        while let Some(chunk) = response.chunk().await.map_err(|_| unavailable())? {
            if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(unavailable());
            }
            bytes.extend_from_slice(&chunk);
        }
        let ranges = std::str::from_utf8(&bytes).map_err(|_| unavailable())?;
        let mut found = false;
        let mut entries = 0;
        for line in ranges.lines() {
            let (hash, count) = line.trim().split_once(':').ok_or_else(unavailable)?;
            if hash.len() != 35 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(unavailable());
            }
            let count = count.parse::<u64>().map_err(|_| unavailable())?;
            entries += 1;
            found |= hash.eq_ignore_ascii_case(suffix) && count > 0;
        }
        if entries == 0 {
            return Err(unavailable());
        }
        if found {
            return Err(AuthError::Upstream {
                status: 400,
                code: "PASSWORD_COMPROMISED",
                message: "Password has been compromised",
            });
        }
        Ok(())
    }
}

fn unavailable() -> AuthError {
    AuthError::Upstream {
        status: 503,
        code: "PASSWORD_CHECK_UNAVAILABLE",
        message: "Password check unavailable",
    }
}
