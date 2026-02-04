# YOLO Image Annotator

Simple local web-based annotator for YOLO format.

Quick start

1. Create a Python virtualenv and install requirements:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Run the app:

```powershell
python main.py
```

3. Open http://127.0.0.1:5000 in your browser.

Usage notes

- Enter server-accessible `source` and `dest` directories (absolute paths on the machine running the server).
- Draw boxes on images (left mouse button drag). Set numeric class id.
- Click `Save Annotation` to write a YOLO .txt file in the destination directory.
- Save/load projects to resume later; projects are stored in the `projects/` folder.
- Zoom in and out on the image with the mouse scroll wheel.
- Move the image around after zooming in (right mouse button drag) or use the sliders.
- left/right arrows or a/d button are shortcuts for prev/next image actions.
- Ctrl+z and Ctrl+y are shortcuts for undo/redo actions.

Development notes
If you have suggestions or find issues, please open an issue or a pull request on GitHub.
