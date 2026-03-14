# Hot path: folder_paths reads args.base_directory (always None; workflow never passes --base-directory).

class _Args:
    base_directory = None


args = _Args()
