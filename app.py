from flask import Flask, render_template, request, jsonify
import os
import json
import base64
from pypinyin import pinyin, Style
import uuid
from PIL import Image
import re
import requests

# NLP библиотеки
import nltk
from nltk.tokenize import word_tokenize
from nltk.corpus import stopwords
import pymorphy2
from deep_translator import GoogleTranslator

# Китайская токенизация
try:
    import jieba
    JIEBA_AVAILABLE = True
except ImportError:
    JIEBA_AVAILABLE = False
    print("jieba не установлена. Установите: pip install jieba")

# Инициализация NLTK
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt', quiet=True)
    nltk.download('punkt_tab', quiet=True)
    nltk.download('stopwords', quiet=True)
    nltk.download('averaged_perceptron_tagger', quiet=True)

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
        'placeholder': 'Введите слово или предложение...',
        'ocr_prompt': 'Выпиши весь китайский текст с этого изображения. Просто текст, без пояснений.',
        'words_label': 'Слова',
        'words_not_found': 'Слова не найдены. Попробуйте другое фото или ручной ввод',
        'processing': 'Распознавание текста...',
        'completed': '✅ Распознавание китайского текста завершено!',
        'file': 'data/chinese.json',
        'source_lang': 'zh-CN',
        'target_lang': 'ru'
    },
    'english': {
        'name': 'Английский',
        'flag': '🇬🇧',
        'placeholder': 'Enter a word or sentence...',
        'ocr_prompt': 'Extract all English text from this image. Just the text, no explanations.',
        'words_label': 'Слова',
        'words_not_found': 'Слова не найдены. Попробуйте другое фото или ручной ввод',
        'processing': 'Распознавание текста...',
        'completed': '✅ Распознавание английского текста завершено!',
        'file': 'data/english.json',
        'source_lang': 'en',
        'target_lang': 'ru'
    },
    'russian': {
        'name': 'Русский',
        'flag': '🇷🇺',
        'placeholder': 'Введите слово или предложение...',
        'ocr_prompt': 'Выпиши весь русский текст с этого изображения. Просто текст, без пояснений.',
        'words_label': 'Слова',
        'words_not_found': 'Слова не найдены. Попробуйте другое фото или ручной ввод',
        'processing': 'Распознавание текста...',
        'completed': '✅ Распознавание русского текста завершено!',
        'file': 'data/russian.json',
        'source_lang': 'ru',
        'target_lang': 'en'
    }
}

# ============================================================
# РАБОТА С КОЛОДОЙ
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

def get_translation_for_word(word, source_lang='zh-CN', target_lang='ru'):
    if not word:
        return ''
    try:
        translator = GoogleTranslator(source=source_lang, target=target_lang)
        return translator.translate(word)
    except Exception as e:
        return ''

def get_translation_api(text, source_lang='auto', target_lang='ru'):
    """API для перевода текста"""
    if not text:
        return ''
    try:
        translator = GoogleTranslator(source=source_lang, target=target_lang)
        return translator.translate(text)
    except Exception as e:
        print(f"Ошибка перевода: {e}")
        return ''

# ============================================================
# ТЕКСТОВАЯ ОБРАБОТКА
# ============================================================
STOP_WORDS = {
    'english': set(stopwords.words('english')),
    'russian': set(stopwords.words('russian')) if 'russian' in stopwords.fileids() else set(),
}

RUSSIAN_STOP_WORDS = {
    'и', 'в', 'не', 'на', 'я', 'он', 'что', 'с', 'а', 'к', 'но', 'по', 'о', 'у', 'из', 'за',
    'так', 'же', 'бы', 'его', 'её', 'ее', 'мы', 'вы', 'они', 'оно', 'она', 'это', 'этот',
    'эта', 'эти', 'том', 'также', 'чтобы', 'для', 'без', 'до', 'при'
}

CHINESE_STOP_WORDS = {
    '的', '了', '在', '是', '我', '你', '他', '她', '它', '我们', '你们', '他们', '她们', '它们',
    '这', '那', '这些', '那些', '这里', '那里', '哪', '这', '那', '有', '和', '与', '或',
    '但', '而', '却', '就', '还', '也', '都', '不', '没', '有', '会', '能', '可以', '要',
    '把', '被', '给', '让', '叫', '使', '对', '从', '到', '上', '下', '里', '外', '中', '前', '后',
    '左', '右', '东', '西', '南', '北', '来', '去', '说', '做', '看', '吃', '喝', '走', '跑',
    '儿', '着', '过', '地', '得', '为', '所', '而', '且', '也', '之', '乎', '者', '也',
    '与', '其', '或', '并', '及', '如', '若', '虽', '然', '则', '乃', '于', '焉', '哉',
    '呢', '吗', '吧', '啊', '呀', '哦', '嗯', '呵', '哈', '嘿', '哎', '喂', '哦', '嗯'
}

def remove_pinyin(text):
    text = re.sub(r'\([a-zāīūōǖáíúóǘǎǐǔǒǚàìùòǜ\s]+\)', '', text)
    text = re.sub(r'[a-zA-Zāīūōǖáíúóǘǎǐǔǒǚàìùòǜ]+', '', text)
    text = re.sub(r'[+\-]', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def clean_text(text, language='chinese'):
    if language == 'chinese':
        text = remove_pinyin(text)
        text = re.sub(r'[^\u4e00-\u9fff\d\s]', ' ', text)
    else:
        text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def tokenize_chinese(text):
    if not JIEBA_AVAILABLE:
        return []
    words = jieba.lcut(text)
    filtered_words = []
    for word in words:
        if not word or word.strip() == '':
            continue
        if word in CHINESE_STOP_WORDS:
            continue
        if word.isdigit():
            continue
        if len(word) == 1 and not '\u4e00' <= word <= '\u9fff':
            continue
        filtered_words.append(word)
    return filtered_words

def tokenize_english(text):
    try:
        tokens = word_tokenize(text.lower())
        stop_words = STOP_WORDS.get('english', set())
        return [t for t in tokens if t not in stop_words and len(t) > 2 and t.isalpha()]
    except:
        return [w for w in text.lower().split() if len(w) > 2 and w.isalpha()]

def tokenize_russian(text):
    try:
        morph = pymorphy2.MorphAnalyzer()
        tokens = word_tokenize(text.lower())
        stop_words = STOP_WORDS.get('russian', RUSSIAN_STOP_WORDS)
        result = []
        for token in tokens:
            if token not in stop_words and len(token) > 2 and token.isalpha():
                lemma = morph.parse(token)[0].normal_form
                if lemma not in result:
                    result.append(lemma)
        return result
    except:
        return [w for w in text.lower().split() if len(w) > 2 and w.isalpha()]

def process_ocr_text(text, language='chinese'):
    cleaned = clean_text(text, language)
    
    if language == 'chinese':
        tokens = tokenize_chinese(cleaned)
    elif language == 'english':
        tokens = tokenize_english(cleaned)
    else:
        tokens = tokenize_russian(cleaned)
    
    seen = set()
    unique_tokens = []
    for token in tokens:
        if token not in seen:
            seen.add(token)
            unique_tokens.append(token)
    
    result = []
    for token in unique_tokens[:50]:
        if not token or token.strip() == '':
            continue
        item = {'word': token}
        if language == 'chinese':
            pinyin_text = get_pinyin(token)
            translation = get_translation_for_word(token, 'zh-CN', 'ru')
            item['translation'] = f"{pinyin_text} - {translation}" if translation else pinyin_text
        elif language == 'english':
            translation = get_translation_for_word(token, 'en', 'ru')
            item['translation'] = translation if translation else ''
        else:
            translation = get_translation_for_word(token, 'ru', 'en')
            item['translation'] = translation if translation else ''
        result.append(item)
    return result

# ============================================================
# OLLAMA OCR
# ============================================================
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
        response = requests.post('http://localhost:11434/api/generate',
            json={
                'model': model,
                'prompt': prompt,
                'images': [img_b64],
                'stream': False,
                'temperature': 0.1,
                'num_predict': 1000
            },
            timeout=60
        )
        
        if response.status_code != 200:
            return [], f"HTTP {response.status_code}"
        
        result = response.json()
        raw_text = result.get('response', '')
        
        if language == 'chinese' and not re.search(r'[\u4e00-\u9fff]', raw_text):
            return [], "На изображении не найдены китайские иероглифы"
        elif language == 'english' and not re.search(r'[a-zA-Z]', raw_text):
            return [], "На изображении не найдены английские слова"
        elif language == 'russian' and not re.search(r'[а-яА-ЯёЁ]', raw_text):
            return [], "На изображении не найдены русские слова"
        
        words = process_ocr_text(raw_text, language)
        
        if not words:
            return [], lang_config['words_not_found']
        
        return words[:30], None
        
    except requests.exceptions.Timeout:
        return [], "Таймаут 60 секунд"
    except Exception as e:
        return [], str(e)

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
    
    if not translation and language == 'chinese':
        translation = get_translation_for_word(word, 'zh-CN', 'ru')
    elif not translation and language == 'english':
        translation = get_translation_for_word(word, 'en', 'ru')
    elif not translation and language == 'russian':
        translation = get_translation_for_word(word, 'ru', 'en')
    
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

@app.route('/api/translate', methods=['POST'])
def translate():
    """API для перевода текста (используется в ручном вводе)"""
    data = request.json
    text = data.get('text', '')
    source = data.get('source', 'auto')
    target = data.get('target', 'ru')
    
    translation = get_translation_api(text, source, target)
    return jsonify({'translation': translation})

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

@app.route('/privacy')
def privacy():
    return render_template('privacy.html')

@app.route('/terms')
def terms():
    return render_template('terms.html')

if __name__ == '__main__':
    print("=" * 50)
    print("🎴 LINGUA OCR")
    print("=" * 50)
    print("📱 http://localhost:5000")
    print(f"🤖 Ollama: {'✅' if check_ollama() else '❌'}")
    print("=" * 50)
    app.run(debug=False, host='0.0.0.0', port=5000)