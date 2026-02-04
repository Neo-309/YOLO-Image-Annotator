from flask import Flask, request, jsonify, send_from_directory, send_file, abort
import os
import json
from pathlib import Path
from PIL import Image

app = Flask(__name__, static_folder='static', static_url_path='')

PROJECTS_DIR = Path('projects')
PROJECTS_DIR.mkdir(exist_ok=True)


def is_image_file(name: str):
    return name.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.gif'))


def list_images(src_dir):
    imgs = []
    for root, dirs, files in os.walk(src_dir):
        for f in files:
            if is_image_file(f):
                full = os.path.join(root, f)
                imgs.append(os.path.abspath(full))
    imgs.sort()
    return imgs


def save_yolo_annotation(dest_dir, image_path, annotations):
    # annotations: list of {class: int, x: float, y: float, w: float, h: float}
    rel = os.path.splitext(os.path.basename(image_path))[0] + '.txt'
    dest = os.path.join(dest_dir, rel)
    with open(dest, 'w', encoding='utf8') as f:
        for a in annotations:
            f.write(f"{a['class']} {a['x']} {a['y']} {a['w']} {a['h']}\n")


@app.route('/')
def index():
    return app.send_static_file('index.html')


@app.route('/api/set_dirs', methods=['POST'])
def api_set_dirs():
    data = request.json or {}
    src = data.get('source_dir')
    dst = data.get('dest_dir')
    if not src or not dst:
        return jsonify({'error': 'source_dir and dest_dir required'}), 400
    src = os.path.abspath(src)
    dst = os.path.abspath(dst)
    if not os.path.isdir(src):
        return jsonify({'error': 'source_dir not found'}), 400
    os.makedirs(dst, exist_ok=True)
    imgs = list_images(src)
    return jsonify({'count': len(imgs)})


@app.route('/api/list_images', methods=['GET'])
def api_list_images():
    src = request.args.get('source_dir')
    if not src:
        return jsonify({'error': 'source_dir required'}), 400
    src = os.path.abspath(src)
    if not os.path.isdir(src):
        return jsonify({'error': 'source_dir not found'}), 400
    imgs = list_images(src)
    # return paths relative to source dir so client can request by index
    rels = [os.path.relpath(p, src) for p in imgs]
    return jsonify({'images': rels})


@app.route('/api/image')
def api_image():
    src = request.args.get('source_dir')
    rel = request.args.get('relpath')
    if not src or not rel:
        return jsonify({'error': 'source_dir and relpath required'}), 400
    src = os.path.abspath(src)
    img_path = os.path.abspath(os.path.join(src, rel))
    if not img_path.startswith(src):
        return jsonify({'error': 'invalid path'}), 400
    if not os.path.isfile(img_path):
        return jsonify({'error': 'file not found'}), 404
    return send_file(img_path)


@app.route('/api/save_annotation', methods=['POST'])
def api_save_annotation():
    data = request.json or {}
    src = data.get('source_dir')
    dst = data.get('dest_dir')
    rel = data.get('relpath')
    annotations = data.get('annotations', [])
    if not src or not dst or not rel:
        return jsonify({'error': 'missing fields'}), 400
    src = os.path.abspath(src)
    dst = os.path.abspath(dst)
    img_path = os.path.abspath(os.path.join(src, rel))
    if not img_path.startswith(src) or not os.path.isfile(img_path):
        return jsonify({'error': 'invalid image path'}), 400
    os.makedirs(dst, exist_ok=True)
    save_yolo_annotation(dst, img_path, annotations)
    return jsonify({'ok': True})


@app.route('/api/save_project', methods=['POST'])
def api_save_project():
    data = request.json or {}
    name = data.get('name')
    payload = data.get('project')
    if not name or payload is None:
        return jsonify({'error': 'name and project required'}), 400
    path = PROJECTS_DIR / (name + '.json')
    with open(path, 'w', encoding='utf8') as f:
        json.dump(payload, f, indent=2)
    return jsonify({'ok': True, 'path': str(path)})


@app.route('/api/load_project', methods=['GET'])
def api_load_project():
    name = request.args.get('name')
    if not name:
        return jsonify({'error': 'name required'}), 400
    path = PROJECTS_DIR / (name + '.json')
    if not path.exists():
        return jsonify({'error': 'project not found'}), 404
    with open(path, 'r', encoding='utf8') as f:
        payload = json.load(f)
    return jsonify({'project': payload})


@app.route('/api/list_projects')
def api_list_projects():
    items = []
    for p in PROJECTS_DIR.glob('*.json'):
        items.append(p.stem)
    return jsonify({'projects': items})


@app.route('/api/load_annotation')
def api_load_annotation():
    dest = request.args.get('dest_dir')
    rel = request.args.get('relpath')
    if not dest or not rel:
        return jsonify({'error': 'dest_dir and relpath required'}), 400
    dest = os.path.abspath(dest)
    # annotation filename: same base name with .txt
    ann_path = os.path.join(dest, os.path.splitext(os.path.basename(rel))[0] + '.txt')
    if not os.path.isfile(ann_path):
        return jsonify({'annotations': []})
    anns = []
    try:
        with open(ann_path, 'r', encoding='utf8') as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) >= 5:
                    cls = int(parts[0])
                    x, y, w, h = map(float, parts[1:5])
                    anns.append({'class': cls, 'x': x, 'y': y, 'w': w, 'h': h})
    except Exception:
        return jsonify({'error': 'failed to read annotation'}), 500
    return jsonify({'annotations': anns})


@app.route('/api/rotate_image', methods=['POST'])
def api_rotate_image():
    data = request.json or {}
    src = data.get('source_dir')
    rel = data.get('relpath')
    direction = data.get('direction')  # 'left' or 'right'
    if not src or not rel or direction not in ('left', 'right'):
        return jsonify({'error': 'source_dir, relpath, and direction required'}), 400
    src = os.path.abspath(src)
    img_path = os.path.abspath(os.path.join(src, rel))
    if not img_path.startswith(src) or not os.path.isfile(img_path):
        return jsonify({'error': 'invalid image path'}), 400
    try:
        img = Image.open(img_path)
        # Rotate 90 degrees: left=CCW=270, right=CW=90
        angle = 270 if direction == 'left' else 90
        img = img.rotate(angle, expand=True)
        img.save(img_path)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)


if __name__ == '__main__':
    app.run(debug=False, port=5000)
