from flask import Flask, render_template, request, jsonify, session
import os
import json
import base64
from pypinyin import pinyin, Style
import uuid
from PIL import Image, ImageEnhance
import time
import re
import traceback
from datetime import datetime

app = Flask(__name__)
app.secret_key = 'your-secret-key-change-this'
app.config['UPLOAD_FOLDER'] = 'uploads'
os.makedirs('uploads', exist_ok=True)
os.makedirs('data', exist_ok=True)

# ============================================================
# ПОДДЕРЖИВАЕМЫЕ ЯЗЫКИ
# ============================================================
LANGUAGES = {
    'chinese': {
        'name': '中文',
        'name_en': 'Chinese',
        'flag': '🇨🇳',
        'ocr_prompt': 'Extract all Chinese characters from this image. One per line. Only characters, no explanations.',
        'is_chinese': True,
        'file': 'data/chinese.json'
    },
    'english': {
        'name': 'English',
        'name_en': 'English',
        'flag': '🇬🇧',
        'ocr_prompt': 'Extract all English words from this image. One per line. Only words, no explanations.',
        'is_chinese': False,
        'file': 'data/english.json'
    },
    'russian': {
        'name': 'Русский',
        'name_en': 'Russian',
        'flag': '🇷🇺',
        'ocr_prompt': 'Extract all Russian words from this image. One per line. Only words, no explanations.',
        'is_chinese': False,
        'file': 'data/russian.json'
    }
}

# ============================================================
# РАБОТА С КОЛОДАМИ
# ============================================================

def get_deck_file(language='chinese'):
    """Получить путь к файлу колоды для языка"""
    lang_config = LANGUAGES.get(language, LANGUAGES['chinese'])
    return lang_config['file']

def load_deck(language='chinese'):
    """Загрузить колоду для конкретного языка"""
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
    """Сохранить колоду для конкретного языка"""
    deck_file = get_deck_file(language)
    try:
        with open(deck_file, 'w', encoding='utf-8') as f:
            json.dump(deck, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Ошибка сохранения: {e}")

def get_pinyin(word):
    """Получить пиньинь для китайского слова (только для китайского)"""
    try:
        result = pinyin(word, style=Style.TONE3, errors='ignore')
        return ' '.join([r[0] for r in result if r])
    except:
        return ''

# ============================================================
# OCR ЧЕРЕЗ OLLAMA (ОБНОВЛЕН)
# ============================================================

def check_ollama():
    """Проверяет, запущен ли Ollama"""
    try:
        import requests
        response = requests.get('http://localhost:11434/api/tags', timeout=3)
        return response.status_code == 200
    except:
        return False

def extract_text_with_ollama(image_path, language='chinese'):
    """
    Распознаёт текст через Ollama с учётом языка
    """
    import requests
    import base64
    
    lang_config = LANGUAGES.get(language, LANGUAGES['chinese'])
    prompt = lang_config['ocr_prompt']
    
    try:
        with open(image_path, 'rb') as f:
            img_b64 = base64.b64encode(f.read()).decode()
        
        start = time.time()
        
        # Определяем модель в зависимости от языка
        if language == 'chinese':
            model = 'llava:7b'  # или 'qwen2-vl:7b'
        else:
            model = 'llava:7b'  # Для английского/русского тоже подходит
        
        response = requests.post('http://localhost:11434/api/generate',
            json={
                'model': model,
                'prompt': prompt,
                'images': [img_b64],
                'stream': False,
                'temperature': 0.1,
                'num_predict': 200
            },
            timeout=60
        )
        
        elapsed = time.time() - start
        print(f"✅ OCR за {elapsed:.1f} сек")
        
        if response.status_code != 200:
            return []
        
        text = response.json().get('response', '')
        
        # Извлекаем слова/символы
        words = []
        seen = set()
        
        for line in text.strip().split('\n'):
            line = line.strip()
            line = re.sub(r'^[\d\.\-\*•]+', '', line).strip()
            
            if language == 'chinese':
                # Для китайского: только иероглифы
                clean = ''.join([c for c in line if '\u4e00' <= c <= '\u9fff'])
                if clean and clean not in seen and len(clean) <= 4:
                    seen.add(clean)
                    words.append({'word': clean, 'translation': get_pinyin(clean)})
            else:
                # Для других языков: слова через пробел
                clean = re.sub(r'[^\w\s-]', '', line).strip().lower()
                if clean and clean not in seen and len(clean.split()) <= 3:
                    seen.add(clean)
                    words.append({'word': clean, 'translation': ''})
        
        return words[:30]
        
    except Exception as e:
        print(f"❌ OCR ошибка: {e}")
        return []

# ============================================================
# FLASK МАРШРУТЫ
# ============================================================

@app.route('/')
def index():
    return render_template('index.html', languages=LANGUAGES)

@app.route('/api/languages', methods=['GET'])
def get_languages():
    return jsonify(LANGUAGES)

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
    return jsonify({'status': 'added', 'deck': deck})

@app.route('/api/deck/<language>/<word>', methods=['DELETE'])
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
    """OCR распознавание"""
    if 'image' not in request.files:
        return jsonify({'error': 'Нет файла'}), 400
    
    file = request.files['image']
    language = request.form.get('language', 'chinese')
    
    if file.filename == '':
        return jsonify({'error': 'Файл не выбран'}), 400
    
    # Сохраняем файл
    ext = os.path.splitext(file.filename)[1]
    if not ext:
        ext = '.jpg'
    
    temp_path = os.path.join('uploads', f'temp_{uuid.uuid4().hex}{ext}')
    file.save(temp_path)
    
    # Распознаём
    if check_ollama():
        words = extract_text_with_ollama(temp_path, language)
    else:
        words = []
    
    # Удаляем временный файл
    try:
        os.remove(temp_path)
    except:
        pass
    
    return jsonify({'words': words})

@app.route('/api/pinyin', methods=['POST'])
def get_pinyin_route():
    data = request.json
    text = data.get('text', '')
    return jsonify({'pinyin': get_pinyin(text)})

if __name__ == '__main__':
    print("=" * 60)
    print("🎴 LANGUAGE FLASHCARDS")
    print("=" * 60)
    print("📱 http://localhost:5000")
    print(f"🤖 Ollama: {'✅ Доступен' if check_ollama() else '❌ Не доступен'}")
    print("=" * 60)
    app.run(debug=True)