//! Narrow capability boundary for the report intake service.
//!
//! This crate exposes the storage, authentication, validation, and shared
//! report types required by intake. Compute launch APIs stay outside this API.

pub use ilxyr_core::{
    AuthenticatedReportAcceptance, Error, ExecutionReport, Workspace,
    accept_authenticated_remote_report, authenticate_report_intake_credential,
    issue_report_intake_credential, record_authenticated_report_rejection,
};
