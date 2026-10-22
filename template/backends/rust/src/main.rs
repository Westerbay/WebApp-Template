#[tokio::main]
async fn main() -> std::process::ExitCode {
    match webapp_api::cli::run().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("Rust API failed: {code}");
            std::process::ExitCode::FAILURE
        }
    }
}
