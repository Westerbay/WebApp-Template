//! API composition, feature modules and concrete infrastructure have separate owners.
mod app;
mod bootstrap;
pub mod cli;
pub mod config;
mod contracts;
#[cfg(feature = "fixtures")]
pub mod fixtures;
pub mod infrastructure;
mod modules;
pub mod openapi;
mod server;

pub use app::Application;
pub use infrastructure::auth::AuthServices;
