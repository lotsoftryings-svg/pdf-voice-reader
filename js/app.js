// PDF Voice Reader - Main Application
// Uses pdf.js for PDF parsing and Web Speech API for TTS

const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

class PDFVoiceReader {
  constructor() {
    this.pdfDoc = null;
    this.pages = []; // Array of text per page
    this.totalPages = 0;
    this.currentPage = 0; // 0-indexed
    this.currentChunkIndex = 0;
    this.chunks = []; // Current page split into sentence chunks
    this.isPlaying = false;
    this.isPaused = false;
    this.rate = 1.0;
    this.selectedVoice = null;
    this.voices = [];
    this.utterance = null;
    this.highlightEnabled = true;
    this.autoScrollEnabled = true;
    this.startTime = null;
    this.elapsedTime = 0;
    this.timerInterval = null;
    this.fileName = '';
    this.detectedLanguages = []; // [{code: 'pt', name: 'Portuguese', confidence: 0.85}, ...]
    this.allVoices = [];

    this.initElements();
    this.initEvents();
    this.cacheVoices();
  }

  initElements() {
    // Screens
    this.uploadScreen = document.getElementById('upload-screen');
    this.readerScreen = document.getElementById('reader-screen');

    // Upload
    this.dropZone = document.getElementById('drop-zone');
    this.fileInput = document.getElementById('file-input');
    this.fileInfo = document.getElementById('file-info');

    // Reader header
    this.backBtn = document.getElementById('back-btn');
    this.pdfTitle = document.getElementById('pdf-title');
    this.pageIndicator = document.getElementById('page-indicator');
    this.settingsBtn = document.getElementById('settings-btn');
    this.settingsPanel = document.getElementById('settings-panel');

    // Progress
    this.progressFill = document.getElementById('progress-fill');
    this.currentTimeEl = document.getElementById('current-time');
    this.pagesReadEl = document.getElementById('pages-read');

    // Text display
    this.textDisplay = document.getElementById('text-display');
    this.textContent = document.getElementById('text-content');

    // Controls
    this.playBtn = document.getElementById('play-btn');
    this.playIcon = document.getElementById('play-icon');
    this.pauseIcon = document.getElementById('pause-icon');
    this.rewindBtn = document.getElementById('rewind-btn');
    this.forwardBtn = document.getElementById('forward-btn');
    this.prevPageBtn = document.getElementById('prev-page-btn');
    this.nextPageBtn = document.getElementById('next-page-btn');
    this.pageJumpInput = document.getElementById('page-jump-input');
    this.totalPagesLabel = document.getElementById('total-pages-label');
    this.speedSlider = document.getElementById('speed-slider');
    this.speedValue = document.getElementById('speed-value');
    this.voiceSelect = document.getElementById('voice-select');

    // Settings
    this.highlightToggle = document.getElementById('highlight-toggle');
    this.autoscrollToggle = document.getElementById('autoscroll-toggle');
    this.darkmodeToggle = document.getElementById('darkmode-toggle');
    this.textSizeSlider = document.getElementById('text-size-slider');
    this.closeSettingsBtn = document.getElementById('close-settings');

    // Loading
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.loadingText = document.getElementById('loading-text');
    this.loadingProgressBar = document.getElementById('loading-progress-bar');
  }

  initEvents() {
    // File upload
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-over');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drag-over');
    });
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/pdf') {
        this.handleFile(file);
      }
    });
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.handleFile(file);
    });

    // Navigation
    this.backBtn.addEventListener('click', () => this.goBack());
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.rewindBtn.addEventListener('click', () => this.prevPage());
    this.forwardBtn.addEventListener('click', () => this.nextPage());
    this.prevPageBtn.addEventListener('click', () => this.prevPage());
    this.nextPageBtn.addEventListener('click', () => this.nextPage());
    this.pageJumpInput.addEventListener('change', () => {
      const page = parseInt(this.pageJumpInput.value);
      if (page >= 1 && page <= this.totalPages) {
        this.goToPage(page - 1);
      }
    });

    // Speed
    this.speedSlider.addEventListener('input', () => {
      this.rate = parseFloat(this.speedSlider.value);
      this.speedValue.textContent = `${this.rate.toFixed(1)}x`;
      // If currently playing, restart current chunk with new speed
      if (this.isPlaying && !this.isPaused) {
        this.restartCurrentChunk();
      }
    });

    // Voice
    this.voiceSelect.addEventListener('change', () => {
      const voiceName = this.voiceSelect.value;
      this.selectedVoice = this.allVoices.find(v => v.name === voiceName) || null;
      if (this.isPlaying && !this.isPaused) {
        this.restartCurrentChunk();
      }
    });

    // Settings
    this.settingsBtn.addEventListener('click', () => {
      this.settingsPanel.classList.toggle('hidden');
    });
    this.closeSettingsBtn.addEventListener('click', () => {
      this.settingsPanel.classList.add('hidden');
    });
    this.highlightToggle.addEventListener('change', () => {
      this.highlightEnabled = this.highlightToggle.checked;
    });
    this.autoscrollToggle.addEventListener('change', () => {
      this.autoScrollEnabled = this.autoscrollToggle.checked;
    });
    this.darkmodeToggle.addEventListener('change', () => {
      document.body.classList.toggle('light-mode', !this.darkmodeToggle.checked);
    });
    this.textSizeSlider.addEventListener('input', () => {
      this.textContent.style.fontSize = `${this.textSizeSlider.value}px`;
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (this.readerScreen.classList.contains('active')) {
        if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
          e.preventDefault();
          this.togglePlay();
        } else if (e.code === 'ArrowLeft') {
          this.prevPage();
        } else if (e.code === 'ArrowRight') {
          this.nextPage();
        } else if (e.code === 'ArrowUp') {
          this.speedSlider.value = Math.min(3, this.rate + 0.1);
          this.speedSlider.dispatchEvent(new Event('input'));
        } else if (e.code === 'ArrowDown') {
          this.speedSlider.value = Math.max(0.5, this.rate - 0.1);
          this.speedSlider.dispatchEvent(new Event('input'));
        }
      }
    });

    // Handle page visibility (pause when tab is hidden on some browsers)
    document.addEventListener('visibilitychange', () => {
      // Some browsers stop TTS when tab is hidden; we handle resume
    });
  }

  // --- Language Detection ---
  // Lightweight stop-word based language detector
  detectLanguages(text) {
    const sample = text.slice(0, 10000).toLowerCase();
    const words = sample.match(/[\p{L}]+/gu) || [];
    if (words.length === 0) return [{ code: 'en', name: 'English', confidence: 0.5 }];

    const stopWords = {
      en: { words: ['the','and','is','in','to','of','a','that','it','for','was','on','are','with','as','this','be','at','have','from','or','an','by','not','but','what','all','were','when','we','there','can','been','has','more','if','will','no','do','my','they','you','he','she','her','his'], name: 'English' },
      es: { words: ['de','la','el','en','y','los','que','del','las','un','por','con','una','su','para','es','al','lo','como','más','pero','sus','le','ya','fue','este','ha','sí','porque','esta','entre','cuando','muy','sin','sobre','también','me','hasta','hay','donde','quien','desde','todo','nos','durante','todos','uno','les','ni','contra','otros','ese','eso','ante','ellos','era'], name: 'Spanish' },
      pt: { words: ['de','a','o','que','e','do','da','em','um','para','é','com','não','uma','os','no','se','na','por','mais','as','dos','como','mas','foi','ao','ele','das','tem','à','seu','sua','ou','ser','quando','muito','há','nos','já','está','eu','também','só','pelo','pela','até','isso','ela','entre','era','depois','sem','mesmo','aos','ter','seus','quem','nas','me','esse','eles','estão','você','tinha','foram','essa','num','nem','suas','meu','às','minha','têm','numa','pelos','elas','havia','seja','qual'], name: 'Portuguese' },
      fr: { words: ['de','la','le','et','les','des','en','un','du','une','que','est','pour','qui','dans','ce','il','pas','plus','par','sur','ne','se','au','avec','son','tout','mais','aux','aussi','été','comme','cette','ou','ses','nous','leur','ont','dit','elle','même','avant','donc','fait','bien','où','entre','très','sans','peut','ces','après','être','tous','deux','aussi','autres'], name: 'French' },
      de: { words: ['der','die','und','in','den','von','zu','das','mit','sich','des','auf','für','ist','im','dem','nicht','ein','eine','als','auch','es','an','er','hat','aus','bei','wurde','nach','wird','wie','noch','oder','einem','sind','war','über','aber','vor','zur','ihre','nur','sein','eines','wenn','so','bis','diese','durch','sie','haben','kann','mehr','seinen'], name: 'German' },
      it: { words: ['di','e','il','la','che','in','un','è','per','non','una','sono','del','le','da','con','si','dei','ha','alla','lo','come','più','al','questo','ma','su','gli','anche','delle','se','nel','della','degli','nella','era','ci','ancora','fra','tutto','dopo','stato','nei','già','cui','delle','dal','tutti','poi','ogni','agli','tanto','così','alle'], name: 'Italian' },
      nl: { words: ['de','het','een','van','en','in','is','dat','op','te','voor','met','zijn','er','niet','aan','ook','als','maar','bij','nog','om','dan','ze','was','die','haar','uit','tot','door','heeft','worden','naar','wel','meer','al','over','kan','geen','dit','mijn','moet','nu','ik','je','hij','we','zo','hun','werd','zij','zou','na'], name: 'Dutch' },
      ru: { words: ['и','в','не','на','я','что','он','с','это','как','его','к','но','они','мы','она','все','так','по','был','от','за','для','бы','же','вы','да','из','у','ее','то','до','нас','их','нет','есть','уже','ему','ней','при','про','без','них','вот','ним','сам','тут','где','раз','тем','чем'], name: 'Russian' },
      ja: { words: ['の','に','は','を','た','が','で','て','と','し','れ','さ','ある','いる','も','する','から','な','こと','として','い','や','など','なっ','ない','この','ため','その','あっ','よう','また','もの','という','ところ','ここ','まで','られ'], name: 'Japanese' },
      zh: { words: ['的','了','在','是','我','有','和','就','不','人','都','一','一个','上','也','很','到','说','要','去','你','会','着','没有','看','好','自己','这','那','她','他','吗','什么','还','可以','对','为','从','但','年','后','能','过','子','们','中'], name: 'Chinese' },
      ko: { words: ['이','는','은','의','에','를','을','하','가','와','한','에서','도','로','으로','다','있','것','수','나','대','위','그','저','및','또는','되','않','없','있는','하는','하고','되는','하다'], name: 'Korean' },
      ar: { words: ['في','من','على','إلى','أن','هذا','هذه','التي','الذي','ما','لا','كان','عن','هو','هي','قد','كل','ذلك','بين','حتى','بعد','قبل','لم','أو','مع','ثم','إن','عند','لن','أي','كما','فقط','ولا','ليس','وقد','هل'], name: 'Arabic' },
      hi: { words: ['के','का','है','में','की','को','से','हैं','और','ने','पर','इस','एक','कि','यह','भी','नहीं','हो','था','तो','कर','वह','जो','अपने','लिए','या','साथ','ही','उन','हम','इसे'], name: 'Hindi' },
      tr: { words: ['bir','ve','bu','için','de','da','ile','olan','çok','var','en','gibi','daha','ama','ne','hem','ya','ben','mi','ise','benim','kadar','sonra','her','olarak','bunu','onun','içinde','üzerinde','ancak','aynı','nasıl','bazı','oldu','olan'], name: 'Turkish' },
      pl: { words: ['i','w','na','nie','się','z','do','to','jest','że','co','jak','ale','za','od','po','tak','ten','tego','tej','tym','już','o','jego','ich','go','był','być','aby','przez','ze','czy','gdzie','kiedy','jeszcze','tylko','może','bardzo','te'], name: 'Polish' },
      sv: { words: ['och','i','att','en','det','som','är','för','av','den','med','på','till','har','de','inte','om','ett','var','från','kan','men','så','hade','vi','han','hon','sina','alla','efter','också','sig','mycket','sedan','när','nu','över','skulle','bara','utan','under','andra','där'], name: 'Swedish' },
      da: { words: ['og','i','at','er','en','det','den','til','for','på','med','af','de','har','som','ikke','var','der','et','fra','han','hun','kan','men','vil','om','blev','så','efter','eller','også','sig','over','alle','skal','nu','havde','meget','sin','under','ved','da','dem','denne','mod','andet','kun'], name: 'Danish' },
      no: { words: ['og','i','er','det','en','at','å','for','på','med','som','den','av','til','har','de','ikke','var','et','om','fra','han','hun','kan','men','vil','ble','så','etter','eller','også','seg','over','alle','skal','nå','hadde','meget','sin','under','ved','da','dem','denne','mot','annet','kun'], name: 'Norwegian' },
    };

    const totalWords = words.length;
    const results = [];

    for (const [code, data] of Object.entries(stopWords)) {
      const stopSet = new Set(data.words);
      let matches = 0;
      for (const word of words) {
        if (stopSet.has(word)) matches++;
      }
      const confidence = matches / totalWords;
      if (confidence > 0.02) {
        results.push({ code, name: data.name, confidence });
      }
    }

    results.sort((a, b) => b.confidence - a.confidence);

    // Return top languages (at least 1, at most 3 with meaningful confidence)
    if (results.length === 0) {
      return [{ code: 'en', name: 'English', confidence: 0.5 }];
    }

    const topConf = results[0].confidence;
    return results.filter((r, i) => i === 0 || r.confidence > topConf * 0.3).slice(0, 3);
  }

  // Map language code to BCP 47 prefix for voice matching
  langCodeToBCP47(code) {
    const map = {
      en: 'en', es: 'es', pt: 'pt', fr: 'fr', de: 'de', it: 'it',
      nl: 'nl', ru: 'ru', ja: 'ja', zh: 'zh', ko: 'ko', ar: 'ar',
      hi: 'hi', tr: 'tr', pl: 'pl', sv: 'sv', da: 'da', no: 'no', nb: 'nb', nn: 'nn',
    };
    return map[code] || code;
  }

  // Human-readable language name for BCP 47 tag
  langTagToName(tag) {
    try {
      const dn = new Intl.DisplayNames(['en'], { type: 'language' });
      return dn.of(tag) || tag;
    } catch {
      return tag;
    }
  }

  // --- Voice management ---
  cacheVoices() {
    const cache = () => {
      this.allVoices = speechSynthesis.getVoices();
    };
    cache();
    speechSynthesis.onvoiceschanged = cache;
  }

  waitForVoices() {
    return new Promise((resolve) => {
      if (this.allVoices.length > 0) return resolve();
      const check = () => {
        this.allVoices = speechSynthesis.getVoices();
        if (this.allVoices.length > 0) return resolve();
        setTimeout(check, 100);
      };
      speechSynthesis.onvoiceschanged = () => {
        this.allVoices = speechSynthesis.getVoices();
        if (this.allVoices.length > 0) resolve();
      };
      setTimeout(check, 100);
    });
  }

  populateVoicesForLanguages() {
    const detected = this.detectedLanguages;
    if (detected.length === 0) return;

    this.voiceSelect.innerHTML = '';

    // Preferred high-quality voice name fragments
    const preferred = ['Samantha', 'Alex', 'Daniel', 'Karen', 'Moira', 'Tessa', 'Google', 'Microsoft', 'Premium', 'Enhanced', 'Natural'];

    // Collect matching voices grouped by detected language
    const matchedGroups = [];
    const matchedVoiceNames = new Set();

    for (const lang of detected) {
      const bcp = this.langCodeToBCP47(lang.code);
      const matching = this.allVoices.filter(v => {
        const vLang = v.lang.toLowerCase().split(/[-_]/)[0];
        return vLang === bcp;
      });

      // Sort: preferred first, then alphabetical
      matching.sort((a, b) => {
        const ap = preferred.some(p => a.name.includes(p)) ? 0 : 1;
        const bp = preferred.some(p => b.name.includes(p)) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.name.localeCompare(b.name);
      });

      if (matching.length > 0) {
        matchedGroups.push({ lang, voices: matching });
        matching.forEach(v => matchedVoiceNames.add(v.name));
      }
    }

    // Build the <select> with optgroups
    for (const group of matchedGroups) {
      const optgroup = document.createElement('optgroup');
      const pct = Math.round(group.lang.confidence * 100);
      optgroup.label = `${group.lang.name} (${pct}% match)`;

      for (const voice of group.voices) {
        const option = document.createElement('option');
        option.value = voice.name;
        // Friendly display: strip the lang code since it's in the group header
        const region = voice.lang.split(/[-_]/)[1] || '';
        const regionLabel = region ? ` (${region})` : '';
        option.textContent = `${voice.name}${regionLabel}`;
        optgroup.appendChild(option);
      }

      this.voiceSelect.appendChild(optgroup);
    }

    // Add an "Other languages" group with all remaining voices
    const others = this.allVoices.filter(v => !matchedVoiceNames.has(v.name));
    if (others.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = 'Other languages';
      others.sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
      for (const voice of others) {
        const option = document.createElement('option');
        option.value = voice.name;
        option.textContent = `${voice.name} (${voice.lang})`;
        optgroup.appendChild(option);
      }
      this.voiceSelect.appendChild(optgroup);
    }

    // Auto-select the best voice from the top detected language
    if (matchedGroups.length > 0) {
      const best = matchedGroups[0].voices[0];
      this.voiceSelect.value = best.name;
      this.selectedVoice = best;
    } else if (this.allVoices.length > 0) {
      this.selectedVoice = this.allVoices[0];
      this.voiceSelect.value = this.allVoices[0].name;
    }

    // Update the voices array to match what's in the select
    this.voices = this.allVoices;
  }

  async handleFile(file) {
    this.fileName = file.name.replace('.pdf', '');
    this.showLoading('Loading PDF...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      this.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      this.totalPages = this.pdfDoc.numPages;

      await this.extractAllText();

      // Detect language from extracted text
      const allText = this.pages.join(' ');
      this.detectedLanguages = this.detectLanguages(allText);
      console.log('Detected languages:', this.detectedLanguages);

      // Wait for voices to be available, then filter
      await this.waitForVoices();
      this.populateVoicesForLanguages();

      this.currentPage = 0;
      this.currentChunkIndex = 0;
      this.showReaderScreen();
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Failed to load PDF. Please try another file.');
    } finally {
      this.hideLoading();
    }
  }

  async extractAllText() {
    this.pages = [];

    for (let i = 1; i <= this.totalPages; i++) {
      this.updateLoadingProgress(i, this.totalPages);
      const page = await this.pdfDoc.getPage(i);
      const textContent = await page.getTextContent();

      // Build text from items, preserving paragraph structure
      let text = '';
      let lastY = null;

      textContent.items.forEach(item => {
        if (item.str.trim() === '') {
          text += ' ';
          return;
        }

        const currentY = item.transform[5];

        if (lastY !== null) {
          const yDiff = Math.abs(currentY - lastY);
          if (yDiff > 12) {
            // New paragraph
            text += '\n\n';
          } else if (yDiff > 2) {
            // New line
            text += ' ';
          }
        }

        text += item.str;
        lastY = currentY;
      });

      this.pages.push(text.trim());
    }
  }

  showLoading(message) {
    this.loadingText.textContent = message;
    this.loadingProgressBar.style.width = '0%';
    this.loadingOverlay.classList.remove('hidden');
  }

  updateLoadingProgress(current, total) {
    const pct = (current / total) * 100;
    this.loadingProgressBar.style.width = `${pct}%`;
    this.loadingText.textContent = `Extracting text... Page ${current} of ${total}`;
  }

  hideLoading() {
    this.loadingOverlay.classList.add('hidden');
  }

  showReaderScreen() {
    this.uploadScreen.classList.remove('active');
    this.readerScreen.classList.add('active');

    this.pdfTitle.textContent = this.fileName;
    this.totalPagesLabel.textContent = `/ ${this.totalPages}`;
    this.pageJumpInput.max = this.totalPages;

    // Show detected language badge
    const badge = document.getElementById('lang-badge');
    const badgeText = document.getElementById('lang-badge-text');
    if (this.detectedLanguages.length > 0) {
      const names = this.detectedLanguages.map(l => l.name).join(', ');
      badgeText.textContent = `Detected: ${names}`;
      badge.classList.remove('hidden');
    }

    this.renderCurrentPage();
    this.updateProgress();
  }

  goBack() {
    this.stop();
    this.readerScreen.classList.remove('active');
    this.uploadScreen.classList.add('active');
    this.pdfDoc = null;
    this.pages = [];
    this.fileInput.value = '';
  }

  // --- Text chunking ---
  // Split page text into sentence-level chunks to avoid the Chrome bug
  // where long utterances get cut off after ~15 seconds
  splitIntoChunks(text) {
    if (!text || text.trim() === '') return ['(This page is empty)'];

    // Split by sentence boundaries
    const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];

    // Group short sentences together (target ~200 chars per chunk)
    const chunks = [];
    let current = '';

    sentences.forEach(sentence => {
      if (current.length + sentence.length > 250 && current.length > 0) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    });

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks.length > 0 ? chunks : ['(This page is empty)'];
  }

  // --- Rendering ---
  renderCurrentPage() {
    const text = this.pages[this.currentPage] || '(No text on this page)';
    this.chunks = this.splitIntoChunks(text);

    // Render chunks as spans for highlighting
    this.textContent.innerHTML = '';
    this.chunks.forEach((chunk, i) => {
      const span = document.createElement('span');
      span.className = 'chunk';
      span.dataset.index = i;
      span.textContent = chunk + ' ';
      this.textContent.appendChild(span);
    });

    // Update page indicator
    this.pageIndicator.textContent = `Page ${this.currentPage + 1} of ${this.totalPages}`;
    this.pageJumpInput.value = this.currentPage + 1;

    this.highlightChunk(this.currentChunkIndex);
  }

  highlightChunk(index) {
    // Remove previous highlights
    this.textContent.querySelectorAll('.chunk').forEach(el => {
      el.classList.remove('active-chunk');
    });

    if (!this.highlightEnabled) return;

    const chunkEl = this.textContent.querySelector(`.chunk[data-index="${index}"]`);
    if (chunkEl) {
      chunkEl.classList.add('active-chunk');

      if (this.autoScrollEnabled) {
        chunkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  // --- Playback controls ---
  togglePlay() {
    if (this.isPlaying && !this.isPaused) {
      this.pause();
    } else if (this.isPaused) {
      this.resume();
    } else {
      this.play();
    }
  }

  play() {
    if (this.pages.length === 0) return;

    this.isPlaying = true;
    this.isPaused = false;
    this.updatePlayButton();
    this.startTimer();
    this.speakCurrentChunk();
  }

  pause() {
    this.isPaused = true;
    speechSynthesis.pause();
    this.updatePlayButton();
    this.stopTimer();
  }

  resume() {
    this.isPaused = false;
    speechSynthesis.resume();
    this.updatePlayButton();
    this.startTimer();
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    speechSynthesis.cancel();
    this.updatePlayButton();
    this.stopTimer();
    this.currentChunkIndex = 0;
    this.highlightChunk(0);
  }

  speakCurrentChunk() {
    if (!this.isPlaying || this.isPaused) return;

    speechSynthesis.cancel();

    const chunk = this.chunks[this.currentChunkIndex];
    if (!chunk) return;

    this.utterance = new SpeechSynthesisUtterance(chunk);
    this.utterance.rate = this.rate;
    this.utterance.pitch = 1;
    this.utterance.volume = 1;

    if (this.selectedVoice) {
      this.utterance.voice = this.selectedVoice;
    }

    this.highlightChunk(this.currentChunkIndex);

    this.utterance.onend = () => {
      if (!this.isPlaying || this.isPaused) return;

      this.currentChunkIndex++;

      if (this.currentChunkIndex < this.chunks.length) {
        // Next chunk on same page
        this.speakCurrentChunk();
      } else {
        // Page finished - go to next page
        if (this.currentPage < this.totalPages - 1) {
          this.currentPage++;
          this.currentChunkIndex = 0;
          this.renderCurrentPage();
          this.updateProgress();
          this.speakCurrentChunk();
        } else {
          // Finished entire document
          this.isPlaying = false;
          this.isPaused = false;
          this.updatePlayButton();
          this.stopTimer();
        }
      }
    };

    this.utterance.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.error('Speech error:', e.error);
      // Try to continue with next chunk
      this.currentChunkIndex++;
      if (this.currentChunkIndex < this.chunks.length) {
        this.speakCurrentChunk();
      }
    };

    speechSynthesis.speak(this.utterance);
  }

  restartCurrentChunk() {
    if (!this.isPlaying) return;
    speechSynthesis.cancel();
    this.speakCurrentChunk();
  }

  nextPage() {
    if (this.currentPage < this.totalPages - 1) {
      const wasPlaying = this.isPlaying && !this.isPaused;
      speechSynthesis.cancel();
      this.currentPage++;
      this.currentChunkIndex = 0;
      this.renderCurrentPage();
      this.updateProgress();
      if (wasPlaying) {
        this.speakCurrentChunk();
      }
    }
  }

  prevPage() {
    if (this.currentPage > 0) {
      const wasPlaying = this.isPlaying && !this.isPaused;
      speechSynthesis.cancel();
      this.currentPage--;
      this.currentChunkIndex = 0;
      this.renderCurrentPage();
      this.updateProgress();
      if (wasPlaying) {
        this.speakCurrentChunk();
      }
    }
  }

  goToPage(pageIndex) {
    if (pageIndex >= 0 && pageIndex < this.totalPages) {
      const wasPlaying = this.isPlaying && !this.isPaused;
      speechSynthesis.cancel();
      this.currentPage = pageIndex;
      this.currentChunkIndex = 0;
      this.renderCurrentPage();
      this.updateProgress();
      if (wasPlaying) {
        this.speakCurrentChunk();
      }
    }
  }

  // --- UI updates ---
  updatePlayButton() {
    if (this.isPlaying && !this.isPaused) {
      this.playIcon.classList.add('hidden');
      this.pauseIcon.classList.remove('hidden');
      this.playBtn.classList.add('playing');
    } else {
      this.playIcon.classList.remove('hidden');
      this.pauseIcon.classList.add('hidden');
      this.playBtn.classList.remove('playing');
    }
  }

  updateProgress() {
    const pct = ((this.currentPage + 1) / this.totalPages) * 100;
    this.progressFill.style.width = `${pct}%`;
    this.pagesReadEl.textContent = `${this.currentPage + 1} / ${this.totalPages} pages`;
  }

  startTimer() {
    if (this.timerInterval) return;
    if (!this.startTime) this.startTime = Date.now();

    this.timerInterval = setInterval(() => {
      const elapsed = this.elapsedTime + (Date.now() - this.startTime);
      const seconds = Math.floor(elapsed / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      this.currentTimeEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      this.elapsedTime += Date.now() - this.startTime;
      clearInterval(this.timerInterval);
      this.timerInterval = null;
      this.startTime = Date.now();
    }
  }
}

// Initialize app
const reader = new PDFVoiceReader();

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => {
    console.log('SW registration failed:', err);
  });
}
