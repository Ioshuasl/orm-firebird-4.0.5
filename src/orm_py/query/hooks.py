from __future__ import annotations

from typing import Any, Callable, Dict, Literal

HookName = Literal[
    "beforeCreate",
    "afterCreate",
    "beforeUpdate",
    "afterUpdate",
    "beforeSave",
    "afterSave",
    "beforeDestroy",
    "afterDestroy",
]
HookHandler = Callable[[Any], None]

_HOOK_NAMES: tuple[HookName, ...] = (
    "beforeCreate",
    "afterCreate",
    "beforeUpdate",
    "afterUpdate",
    "beforeSave",
    "afterSave",
    "beforeDestroy",
    "afterDestroy",
)

_HOOK_ALIASES: Dict[str, HookName] = {
    # camelCase
    "beforeCreate": "beforeCreate",
    "afterCreate": "afterCreate",
    "beforeUpdate": "beforeUpdate",
    "afterUpdate": "afterUpdate",
    "beforeSave": "beforeSave",
    "afterSave": "afterSave",
    "beforeDestroy": "beforeDestroy",
    "afterDestroy": "afterDestroy",
    # snake_case compatibility
    "before_create": "beforeCreate",
    "after_create": "afterCreate",
    "before_update": "beforeUpdate",
    "after_update": "afterUpdate",
    "before_save": "beforeSave",
    "after_save": "afterSave",
    "before_destroy": "beforeDestroy",
    "after_destroy": "afterDestroy",
}


def default_hooks_dict() -> Dict[str, list[HookHandler]]:
    return {name: [] for name in _HOOK_NAMES}


def normalize_hook_name(name: str) -> HookName:
    if name in _HOOK_ALIASES:
        return _HOOK_ALIASES[name]
    raise ValueError(f'Unknown hook "{name}".')


def add_model_hook(model_cls: Any, name: str, fn: HookHandler) -> None:
    normalized = normalize_hook_name(name)
    hooks = getattr(model_cls, "_hooks", None)
    if not isinstance(hooks, dict):
        hooks = default_hooks_dict()
        setattr(model_cls, "_hooks", hooks)
    hooks.setdefault(normalized, [])
    hooks[normalized].append(fn)


def run_model_hooks(model_cls: Any, name: str, instance: Any) -> None:
    normalized = normalize_hook_name(name)
    hooks = getattr(model_cls, "_hooks", None)
    if not isinstance(hooks, dict):
        return
    for fn in hooks.get(normalized, []):
        fn(instance)


def _hook_api(model_cls: Any, hook_name: str, fn: HookHandler | None = None):
    """
    Convenience API to register hook functions with less boilerplate.

    Usage:
      before_create(UserModel, my_handler)

    Or decorator style:
      @before_create(UserModel)
      def my_handler(instance): ...
    """
    if fn is not None:
        add_model_hook(model_cls, hook_name, fn)
        return fn

    def _decorator(decorated_fn: HookHandler) -> HookHandler:
        add_model_hook(model_cls, hook_name, decorated_fn)
        return decorated_fn

    return _decorator


def before_create(model_cls: Any, fn: HookHandler | None = None):
    return _hook_api(model_cls, "beforeCreate", fn)


def after_create(model_cls: Any, fn: HookHandler | None = None):
    return _hook_api(model_cls, "afterCreate", fn)


def before_update(model_cls: Any, fn: HookHandler | None = None):
    return _hook_api(model_cls, "beforeUpdate", fn)


def after_update(model_cls: Any, fn: HookHandler | None = None):
    return _hook_api(model_cls, "afterUpdate", fn)


def before_save(model_cls: Any, fn: HookHandler | None = None):
    return _hook_api(model_cls, "beforeSave", fn)


def after_save(model_cls: Any, fn: HookHandler | None = None):
    return _hook_api(model_cls, "afterSave", fn)


def before_destroy(model_cls: Any, fn: HookHandler | None = None):
    return _hook_api(model_cls, "beforeDestroy", fn)


def after_destroy(model_cls: Any, fn: HookHandler | None = None):
    return _hook_api(model_cls, "afterDestroy", fn)

