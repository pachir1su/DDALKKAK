from flask import Flask, render_template, jsonify
import random

app = Flask(__name__)

# 마을 생성에 필요한 초기 시드값을 서버에서 관리한다고 가정
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/world-config')
def get_world_config():
    # 서버에서 난수 시드나 월드 설정을 내려줄 수 있음
    config = {
        "seed": random.randint(1, 10000),
        "worldSize": 600,  # 맵 크기
        "houseCount": 400, # 집 개수
        "treeCount": 1500  # 나무 개수
    }
    return jsonify(config)

if __name__ == '__main__':
    print("🌍 마을 생성 서버 가동: http://127.0.0.1:5000")
    app.run(debug=True)
