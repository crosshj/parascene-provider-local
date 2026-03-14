# Hot path: get_filename_list, get_full_path, get_full_path_or_raise, get_folder_paths, add_model_folder_path.
# Workflow only uses categories: diffusion_models, text_encoders, vae, embeddings (and add_model_folder_path from yaml).

from __future__ import annotations

import os
import time
import logging
from collections.abc import Collection

from comfy.cli_args import args

supported_pt_extensions: set[str] = {".ckpt", ".pt", ".pt2", ".bin", ".pth", ".safetensors", ".pkl", ".sft"}

folder_names_and_paths: dict[str, tuple[list[str], set[str]]] = {}

if args.base_directory:
    base_path = os.path.abspath(args.base_directory)
else:
    base_path = os.path.dirname(os.path.realpath(__file__))

models_dir = os.path.join(base_path, "models")
folder_names_and_paths["diffusion_models"] = ([os.path.join(models_dir, "unet"), os.path.join(models_dir, "diffusion_models")], supported_pt_extensions)
folder_names_and_paths["text_encoders"] = ([os.path.join(models_dir, "text_encoders"), os.path.join(models_dir, "clip")], supported_pt_extensions)
folder_names_and_paths["vae"] = ([os.path.join(models_dir, "vae")], supported_pt_extensions)
folder_names_and_paths["embeddings"] = ([os.path.join(models_dir, "embeddings")], supported_pt_extensions)

filename_list_cache: dict[str, tuple[list[str], dict[str, float], float]] = {}


class CacheHelper:
    def __init__(self):
        self.cache: dict[str, tuple[list[str], dict[str, float], float]] = {}
        self.active = False

    def get(self, key: str, default=None) -> tuple[list[str], dict[str, float], float]:
        if not self.active:
            return default
        return self.cache.get(key, default)

    def set(self, key: str, value: tuple[list[str], dict[str, float], float]) -> None:
        if self.active:
            self.cache[key] = value

    def clear(self):
        self.cache.clear()

    def __enter__(self):
        self.active = True
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.active = False
        self.clear()


cache_helper = CacheHelper()


def map_legacy(folder_name: str) -> str:
    legacy = {"unet": "diffusion_models", "clip": "text_encoders"}
    return legacy.get(folder_name, folder_name)


def add_model_folder_path(folder_name: str, full_folder_path: str, is_default: bool = False) -> None:
    global folder_names_and_paths
    folder_name = map_legacy(folder_name)
    if folder_name in folder_names_and_paths:
        paths, _exts = folder_names_and_paths[folder_name]
        if full_folder_path in paths:
            if is_default and paths[0] != full_folder_path:
                paths.remove(full_folder_path)
                paths.insert(0, full_folder_path)
        else:
            if is_default:
                paths.insert(0, full_folder_path)
            else:
                paths.append(full_folder_path)
    else:
        folder_names_and_paths[folder_name] = ([full_folder_path], set())


def get_folder_paths(folder_name: str) -> list[str]:
    folder_name = map_legacy(folder_name)
    return folder_names_and_paths[folder_name][0][:]


def recursive_search(directory: str, excluded_dir_names: list[str] | None = None) -> tuple[list[str], dict[str, float]]:
    if not os.path.isdir(directory):
        return [], {}
    if excluded_dir_names is None:
        excluded_dir_names = []
    result = []
    dirs = {}
    try:
        dirs[directory] = os.path.getmtime(directory)
    except FileNotFoundError:
        logging.warning("Warning: Unable to access %s. Skipping this path.", directory)
    for dirpath, subdirs, filenames in os.walk(directory, followlinks=True, topdown=True):
        subdirs[:] = [d for d in subdirs if d not in excluded_dir_names]
        for file_name in filenames:
            try:
                relative_path = os.path.relpath(os.path.join(dirpath, file_name), directory)
                result.append(relative_path)
            except Exception:
                continue
        for d in subdirs:
            path = os.path.join(dirpath, d)
            try:
                dirs[path] = os.path.getmtime(path)
            except FileNotFoundError:
                continue
    return result, dirs


def filter_files_extensions(files: Collection[str], extensions: Collection[str]) -> list[str]:
    return sorted(list(filter(lambda a: os.path.splitext(a)[-1].lower() in extensions or len(extensions) == 0, files)))


def get_full_path(folder_name: str, filename: str) -> str | None:
    global folder_names_and_paths
    folder_name = map_legacy(folder_name)
    if folder_name not in folder_names_and_paths:
        return None
    folders = folder_names_and_paths[folder_name]
    filename = os.path.relpath(os.path.join("/", filename), "/")
    for x in folders[0]:
        full_path = os.path.join(x, filename)
        if os.path.isfile(full_path):
            return full_path
        elif os.path.islink(full_path):
            logging.warning("WARNING path %s exists but doesn't link anywhere, skipping.", full_path)
    return None


def get_full_path_or_raise(folder_name: str, filename: str) -> str:
    full_path = get_full_path(folder_name, filename)
    if full_path is None:
        raise FileNotFoundError(f"Model in folder '{folder_name}' with filename '{filename}' not found.")
    return full_path


def get_filename_list_(folder_name: str) -> tuple[list[str], dict[str, float], float]:
    folder_name = map_legacy(folder_name)
    global folder_names_and_paths
    output_list = set()
    folders = folder_names_and_paths[folder_name]
    output_folders = {}
    for x in folders[0]:
        files, folders_all = recursive_search(x, excluded_dir_names=[".git"])
        output_list.update(filter_files_extensions(files, folders[1]))
        output_folders = {**output_folders, **folders_all}
    return sorted(list(output_list)), output_folders, time.perf_counter()


def cached_filename_list_(folder_name: str) -> tuple[list[str], dict[str, float], float] | None:
    strong_cache = cache_helper.get(folder_name)
    if strong_cache is not None:
        return strong_cache
    global filename_list_cache, folder_names_and_paths
    folder_name = map_legacy(folder_name)
    if folder_name not in filename_list_cache:
        return None
    out = filename_list_cache[folder_name]
    for x in out[1]:
        if os.path.getmtime(x) != out[1][x]:
            return None
    for x in folder_names_and_paths[folder_name][0]:
        if os.path.isdir(x) and x not in out[1]:
            return None
    return out


def get_filename_list(folder_name: str) -> list[str]:
    folder_name = map_legacy(folder_name)
    out = cached_filename_list_(folder_name)
    if out is None:
        out = get_filename_list_(folder_name)
        global filename_list_cache
        filename_list_cache[folder_name] = out
    cache_helper.set(folder_name, out)
    return list(out[0])
