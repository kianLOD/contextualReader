import type { Book } from '@/db/types';
import { BookImporter } from '@/components/BookImporter';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type LibraryProps = {
  books: Book[];
  onOpen: (bookId: string) => void;
  onDelete: (bookId: string) => void;
  onImported: (book: Book) => void;
};

export function Library({ books, onOpen, onDelete, onImported }: LibraryProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-10 sm:px-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import a book, then tap rare words for meanings in context.
        </p>
      </div>

      <BookImporter onImported={onImported} />

      {books.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No books yet</CardTitle>
            <CardDescription>
              Add an EPUB or plain text file to start reading.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {books.map((book) => (
            <li key={book.id}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">{book.title}</CardTitle>
                  <CardDescription>
                    {book.chapters.length} chapter{book.chapters.length === 1 ? '' : 's'} ·{' '}
                    {new Date(book.addedAt).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => onOpen(book.id)}>
                    Open
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(book.id)}
                  >
                    Delete
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
