import os
from flask import Flask, render_template, send_from_directory

# static_url_path='' : 정적 파일(js, css)을 '/static/file.js'가 아니라 '/file.js'로 접근하게 함
# static_folder='.'  : 정적 파일을 찾는 위치를 현재 폴더로 지정
# template_folder='.' : HTML 파일을 찾는 위치를 현재 폴더로 지정
app = Flask(__name__, static_url_path='', static_folder='.', template_folder='.')

@app.route('/')
def index():
    return render_template('index.html')

# 혹시 모를 정적 파일 경로 문제 대비 (CSS, JS 직접 서빙)
@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    print("🏎️ RACE SERVER STARTED: http://127.0.0.1:5000")
    app.run(debug=True)
