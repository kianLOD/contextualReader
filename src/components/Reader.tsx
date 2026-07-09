import './Reader.css';

type ReaderProps = {
  bookTitle: string;
  chapterTitle: string;
  text: string;
};

export function Reader({ bookTitle, chapterTitle, text }: ReaderProps) {
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <article className="reader">
      <header className="reader__header">
        <p className="reader__book">{bookTitle}</p>
        <h1 className="reader__chapter">{chapterTitle}</h1>
      </header>
      <div className="reader__body">
        {paragraphs.map((paragraph, i) => (
          <p key={i} className="reader__paragraph">
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  );
}
