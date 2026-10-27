pub(super) async fn check(get: &impl Fn(&str) -> Option<String>) -> Result<(), &'static str> {
    let port: u16 = get("API_PORT")
        .unwrap_or_else(|| "3001".into())
        .parse()
        .map_err(|_| "API_PORT_INVALID")?;
    let response = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/health/ready"))
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map_err(|_| "NOT_READY")?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err("NOT_READY")
    }
}
