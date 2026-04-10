export function formatDescriptionHtml(element: HTMLElement): string {
    if (!element) return '';
    const clone = element.cloneNode(true) as HTMLElement;

    clone.querySelectorAll('script, style').forEach(el => el.remove());

    clone.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
        el.outerHTML = `<b>${el.textContent?.trim()}</b>\n`;
    });

    clone.querySelectorAll('ul, ol').forEach(list => {
        Array.from(list.children).forEach(li => {
            li.outerHTML = `• ${li.textContent?.trim()}\n`;
        });
        list.outerHTML = list.textContent + '\n';
    });

    clone.querySelectorAll('p, div').forEach(el => {
        el.outerHTML = el.textContent?.trim() + '\n';
    });

    clone.querySelectorAll('br').forEach(el => {
        el.outerHTML = '\n';
    });

    let text = clone.textContent || '';
    text = text.replace(/\n\s*\n/g, '\n\n');
    text = text.replace(/\s{2,}/g, ' ');
    return text.trim();
}

export function isValidImageUrl(url: string): boolean {
    return url.startsWith('http') && /\.(jpeg|jpg|png|gif|webp)$/i.test(url.split('?')[0]);
}
