#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "ech")]
extern "C" {
    fn profile_enter(ptr: i32, len: i32);
    fn profile_exit();
}

#[cfg(target_arch = "wasm32")]
struct Scope;

#[cfg(target_arch = "wasm32")]
impl Drop for Scope {
    fn drop(&mut self) {
        unsafe { profile_exit() };
    }
}

pub fn measure<T>(name: &'static str, operation: impl FnOnce() -> T) -> T {
    #[cfg(target_arch = "wasm32")]
    let _scope = {
        unsafe { profile_enter(name.as_ptr() as i32, name.len() as i32) };
        Scope
    };
    #[cfg(not(target_arch = "wasm32"))]
    let _ = name;
    operation()
}
