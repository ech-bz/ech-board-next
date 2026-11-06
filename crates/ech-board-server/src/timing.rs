use std::cell::RefCell;
use std::collections::BTreeMap;
use std::future::Future;
use std::time::{Duration, Instant};

tokio::task_local! {
    static CURRENT: RefCell<Timings>;
}

#[derive(Default)]
pub(crate) struct Timings {
    stages: BTreeMap<&'static str, (Duration, usize)>,
    extra: Vec<String>,
}

impl Timings {
    pub(crate) fn header(self) -> String {
        self.stages
            .into_iter()
            .map(|(name, (duration, count))| {
                format!(
                    "{name};dur={:.3};desc=\"calls={count}\"",
                    duration.as_secs_f64() * 1000.0
                )
            })
            .chain(self.extra)
            .collect::<Vec<_>>()
            .join(", ")
    }
}

pub(crate) async fn collect<T>(future: impl Future<Output = T>) -> (T, Timings) {
    CURRENT
        .scope(RefCell::new(Timings::default()), async {
            let value = future.await;
            let timings = CURRENT.with(|current| current.take());
            (value, timings)
        })
        .await
}

pub(crate) struct Timer {
    name: &'static str,
    started: Instant,
}

impl Timer {
    pub(crate) fn new(name: &'static str) -> Self {
        Self {
            name,
            started: Instant::now(),
        }
    }
}

impl Drop for Timer {
    fn drop(&mut self) {
        let duration = self.started.elapsed();
        let _ = CURRENT.try_with(|current| {
            let mut current = current.borrow_mut();
            let entry = current.stages.entry(self.name).or_default();
            entry.0 += duration;
            entry.1 += 1;
        });
    }
}

pub(crate) fn measure<T>(name: &'static str, f: impl FnOnce() -> T) -> T {
    let _timer = Timer::new(name);
    f()
}

pub(crate) async fn measure_async<T>(name: &'static str, future: impl Future<Output = T>) -> T {
    let _timer = Timer::new(name);
    future.await
}

pub(crate) fn extra(value: String) {
    let _ = CURRENT.try_with(|current| {
        let mut current = current.borrow_mut();
        let used: usize = current.extra.iter().map(String::len).sum();
        if used + value.len() <= 6000 {
            current.extra.push(value);
        } else if !current
            .extra
            .iter()
            .any(|entry| entry == "timing_truncated")
        {
            current.extra.push("timing_truncated".to_string());
        }
    });
}

pub(crate) async fn middleware(
    request: actix_web::dev::ServiceRequest,
    next: actix_web::middleware::Next<impl actix_web::body::MessageBody>,
) -> Result<actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>, actix_web::Error> {
    let (response, timings) = collect(measure_async("board", next.call(request))).await;
    let mut response = response?;
    use actix_web::http::header::{HeaderName, HeaderValue};
    if let Ok(value) = HeaderValue::from_str(&timings.header()) {
        response
            .headers_mut()
            .insert(HeaderName::from_static("server-timing"), value);
    }
    response.headers_mut().insert(
        HeaderName::from_static("timing-allow-origin"),
        HeaderValue::from_static("*"),
    );
    Ok(response)
}
