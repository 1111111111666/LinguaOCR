from flask import Flask, render_template, request, jsonify
import os
import json
import base64
from pypinyin import pinyin, Style
import uuid
from PIL import Image
import time
import re
import traceback
import requests

app = Flask(__name__)
app.secret_key = 'your-secret-key-change-this'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
os.makedirs('uploads', exist_ok=True)
os.makedirs('data', exist_ok=True)

# ============================================================
# ПОДДЕРЖИВАЕМЫЕ ЯЗЫКИ
# ============================================================
LANGUAGES = {
    'chinese': {
        'name': 'Китайский',
        'flag': '🇨🇳',
        'placeholder': 'Введите иероглиф или предложение...',
        'ocr_prompt': 'Выпиши все китайские иероглифы с этого изображения. Каждый иероглиф с новой строки. Только иероглифы, без пояснений.',
        'words_label': 'Иероглифы',
        'words_not_found': 'Иероглифы не найдены. Попробуйте другое фото или ручной ввод',
        'processing': 'Распознавание иероглифов...',
        'file': 'data/chinese.json'
    },
    'english': {
        'name': 'Английский',
        'flag': '🇬🇧',
        'placeholder': 'Введите слово или предложение...',
        'ocr_prompt': 'Выпиши все английские слова с этого изображения. Каждое слово с новой строки. Только слова, без пояснений.',
        'words_label': 'Слова',
        'words_not_found': 'Слова не найдены. Попробуйте другое фото или ручной ввод',
        'processing': 'Распознавание слов...',
        'file': 'data/english.json'
    },
    'russian': {
        'name': 'Русский',
        'flag': '🇷🇺',
        'placeholder': 'Введите слово или предложение...',
        'ocr_prompt': 'Выпиши все русские слова с этого изображения. Каждое слово с новой строки. Только слова, без пояснений.',
        'words_label': 'Слова',
        'words_not_found': 'Слова не найдены. Попробуйте другое фото или ручной ввод',
        'processing': 'Распознавание слов...',
        'file': 'data/russian.json'
    }
}

# ============================================================
# РАБОТА С КОЛОДАМИ
# ============================================================

def get_deck_file(language='chinese'):
    lang_config = LANGUAGES.get(language, LANGUAGES['chinese'])
    return lang_config['file']

def load_deck(language='chinese'):
    deck_file = get_deck_file(language)
    if not os.path.exists(deck_file):
        save_deck([], language)
        return []
    try:
        with open(deck_file, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            if not content:
                save_deck([], language)
                return []
            return json.loads(content)
    except:
        save_deck([], language)
        return []

def save_deck(deck, language='chinese'):
    deck_file = get_deck_file(language)
    try:
        with open(deck_file, 'w', encoding='utf-8') as f:
            json.dump(deck, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Ошибка сохранения: {e}")

def get_pinyin(word):
    try:
        result = pinyin(word, style=Style.TONE3, errors='ignore')
        return ' '.join([r[0] for r in result if r])
    except:
        return ''

# ============================================================
# OLLAMA ЛОГИРОВАНИЕ
# ============================================================

def log_ollama_response(image_path, language, prompt, response_text, elapsed, error=None):
    log_file = 'ollama_debug.log'
    try:
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f"\n{'='*80}\n")
            f.write(f"Время: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Язык: {language}\n")
            f.write(f"Изображение: {os.path.basename(image_path)}\n")
            f.write(f"Время ответа: {elapsed:.1f} сек\n")
            if error:
                f.write(f"ОШИБКА: {error}\n")
            f.write(f"{'-'*40}\n")
            f.write(f"ПРОМПТ:\n{prompt}\n")
            f.write(f"{'-'*40}\n")
            f.write(f"ОТВЕТ МОДЕЛИ:\n{response_text}\n")
            f.write(f"{'='*80}\n")
        print(f"📝 Лог сохранён в ollama_debug.log")
    except Exception as e:
        print(f"⚠️ Не удалось сохранить лог: {e}")

def check_ollama():
    try:
        response = requests.get('http://localhost:11434/api/tags', timeout=3)
        return response.status_code == 200
    except:
        return False

def get_ollama_model():
    try:
        response = requests.get('http://localhost:11434/api/tags', timeout=3)
        if response.status_code == 200:
            models = response.json().get('models', [])
            for model in models:
                name = model.get('name', '')
                if 'qwen' in name.lower() or 'llava' in name.lower():
                    return name
            if models:
                return models[0]['name']
        return 'qwen3.5:4b'
    except:
        return 'qwen3.5:4b'

def extract_text_with_ollama(image_path, language='chinese'):
    lang_config = LANGUAGES.get(language, LANGUAGES['chinese'])
    prompt = lang_config['ocr_prompt']
    
    if not check_ollama():
        return [], "Ollama не запущен. Запустите: ollama serve"
    
    try:
        with open(image_path, 'rb') as f:
            img_b64 = base64.b64encode(f.read()).decode()
        
        model = get_ollama_model()
        print(f"🔄 Использую модель: {model}")
        start = time.time()
        
        response = requests.post('http://localhost:11434/api/generate',
            json={
                'model': model,
                'prompt': prompt,
                'images': [img_b64],
                'stream': False,
                'temperature': 0.1,
                'num_predict': 300
            },
            timeout=90
        )
        
        elapsed = time.time() - start
        
        if response.status_code != 200:
            error_msg = f"HTTP {response.status_code}: {response.text}"
            log_ollama_response(image_path, language, prompt, '', elapsed, error_msg)
            return [], error_msg
        
        result = response.json()
        text = result.get('response', '')
        
        log_ollama_response(image_path, language, prompt, text, elapsed)
        print(f"📝 Ответ модели: {text[:300]}")
        
        words = []
        seen = set()
        
        for line in text.strip().split('\n'):
            line = line.strip()
            line = re.sub(r'^[\d\.\-\*•\[\]\(\)]+', '', line).strip()
            
            if not line:
                continue
            
            if language == 'chinese':
                clean = ''.join([c for c in line if '\u4e00' <= c <= '\u9fff'])
                if clean and clean not in seen and len(clean) <= 6:
                    seen.add(clean)
                    words.append({'word': clean, 'translation': get_pinyin(clean)})
            elif language == 'english':
                clean = re.sub(r'[^a-zA-Z\']', '', line).strip().lower()
                if clean and len(clean) >= 2 and len(clean) <= 20 and clean not in seen:
                    seen.add(clean)
                    words.append({'word': clean, 'translation': ''})
            else:
                clean = re.sub(r'[^а-яА-ЯёЁ\-]', '', line).strip().lower()
                if clean and len(clean) >= 2 and len(clean) <= 20 and clean not in seen:
                    seen.add(clean)
                    words.append({'word': clean, 'translation': ''})
        
        return words[:30], None
        
    except requests.exceptions.Timeout:
        error_msg = "Таймаут 90 секунд"
        log_ollama_response(image_path, language, prompt, '', 90, error_msg)
        return [], error_msg
    except Exception as e:
        error_msg = str(e)
        log_ollama_response(image_path, language, prompt, '', 0, error_msg)
        traceback.print_exc()
        return [], error_msg

# ============================================================
# FLASK МАРШРУТЫ
# ============================================================

@app.route('/')
def index():
    return render_template('index.html', languages=LANGUAGES)

@app.route('/api/languages', methods=['GET'])
def get_languages():
    return jsonify(LANGUAGES)

@app.route('/api/ollama/status', methods=['GET'])
def ollama_status():
    running = check_ollama()
    model = get_ollama_model() if running else None
    return jsonify({'running': running, 'model': model})

@app.route('/api/deck/<language>', methods=['GET'])
def get_deck(language):
    deck = load_deck(language)
    return jsonify(deck)

@app.route('/api/deck/<language>', methods=['POST'])
def add_word(language):
    data = request.json
    word = data.get('word')
    translation = data.get('translation', '')
    
    deck = load_deck(language)
    
    for item in deck:
        if item['word'] == word:
            return jsonify({'status': 'exists'})
    
    deck.append({
        'word': word,
        'translation': translation,
        'timestamp': len(deck)
    })
    save_deck(deck, language)
    return jsonify({'status': 'added'})

@app.route('/api/deck/<language>/<path:word>', methods=['DELETE'])
def delete_word(language, word):
    deck = load_deck(language)
    deck = [item for item in deck if item['word'] != word]
    save_deck(deck, language)
    return jsonify({'status': 'deleted'})

@app.route('/api/deck/<language>', methods=['DELETE'])
def clear_deck(language):
    save_deck([], language)
    return jsonify({'status': 'cleared'})

@app.route('/api/ocr', methods=['POST'])
def ocr():
    if 'image' not in request.files:
        return jsonify({'error': 'Нет файла'}), 400
    
    file = request.files['image']
    language = request.form.get('language', 'chinese')
    
    if file.filename == '':
        return jsonify({'error': 'Файл не выбран'}), 400
    
    ext = os.path.splitext(file.filename)[1]
    if not ext or ext.lower() not in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
        ext = '.jpg'
    
    temp_path = os.path.join('uploads', f'temp_{uuid.uuid4().hex}{ext}')
    file.save(temp_path)
    
    with open(temp_path, 'rb') as f:
        image_base64 = base64.b64encode(f.read()).decode()
    
    words, error = extract_text_with_ollama(temp_path, language)
    
    try:
        os.remove(temp_path)
    except:
        pass
    
    return jsonify({
        'words': words,
        'error': error,
        'image_preview': f'data:image/jpeg;base64,{image_base64}'
    })

@app.route('/api/pinyin', methods=['POST'])
def get_pinyin_route():
    data = request.json
    text = data.get('text', '')
    return jsonify({'pinyin': get_pinyin(text)})

if __name__ == '__main__':
    print("=" * 60)
    print("🎴 LINGUA OCR")
    print("=" * 60)
    print("📱 http://localhost:5000")
    print(f"🤖 Ollama: {'✅ Доступен' if check_ollama() else '❌ Не доступен'}")
    if check_ollama():
        print(f"📦 Модель: {get_ollama_model()}")
    else:
        print("\n⚠️ Для распознавания установите Ollama и модель:")
        print("   https://ollama.com/download")
        print("   ollama pull qwen3.5:4b")
        print("   ollama serve")
    print("=" * 60)
    app.run(debug=True)