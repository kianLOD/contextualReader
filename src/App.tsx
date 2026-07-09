import { Reader } from './components/Reader';
import { SAMPLE_CHAPTER } from './data/sampleChapter';
import './App.css';

export default function App() {
  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__brand">Contextual Reader</span>
      </header>
      <main className="app__main">
        <Reader
          bookTitle={SAMPLE_CHAPTER.title}
          chapterTitle={SAMPLE_CHAPTER.chapterTitle}
          text={SAMPLE_CHAPTER.text}
        />
      </main>
    </div>
  );
}
