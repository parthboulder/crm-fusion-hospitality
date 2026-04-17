/**
 * Shared DOM → single-page PDF helper for Stoneriver dashboards.
 *
 * Captures an element with html2canvas and fits the entire thing on ONE A4
 * page. The render is auto-orientation-chosen (landscape vs portrait) to
 * favor whichever gives a larger final image, then scaled down to fit both
 * dimensions within the page margins. Nothing is clipped; nothing spills
 * onto a second page.
 */

export interface ExportTablePdfOptions {
  /** DOM element to capture. Scroll/overflow is temporarily disabled during capture. */
  element: HTMLElement;
  /** Bold title drawn at the top of the page. */
  title: string;
  /** Optional second-line subtitle (e.g. "Report Date: 03/26/2026"). */
  subtitle?: string;
  /** Output filename without extension. */
  filename: string;
  /** Orientation override. Defaults to auto-pick based on element aspect ratio. */
  orientation?: 'landscape' | 'portrait' | 'auto';
}

export async function exportTableToPdf({
  element,
  title,
  subtitle,
  filename,
  orientation = 'auto',
}: ExportTablePdfOptions): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas-pro'),
    import('jspdf'),
  ]);

  // Temporarily strip clipping AND force the element to render at its full
  // scroll width so html2canvas captures the overflowed right-hand columns.
  const prevOverflow = element.style.overflow;
  const prevOverflowX = element.style.overflowX;
  const prevOverflowY = element.style.overflowY;
  const prevMaxWidth = element.style.maxWidth;
  const prevMaxHeight = element.style.maxHeight;
  const prevWidth = element.style.width;
  const prevHeight = element.style.height;

  const fullW = Math.max(element.scrollWidth, element.offsetWidth);
  const fullH = Math.max(element.scrollHeight, element.offsetHeight);

  element.style.overflow = 'visible';
  element.style.overflowX = 'visible';
  element.style.overflowY = 'visible';
  element.style.maxWidth = 'none';
  element.style.maxHeight = 'none';
  element.style.width = `${fullW}px`;
  element.style.height = `${fullH}px`;

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: fullW,
      height: fullH,
      windowWidth: fullW,
      windowHeight: fullH,
    });
  } finally {
    element.style.overflow = prevOverflow;
    element.style.overflowX = prevOverflowX;
    element.style.overflowY = prevOverflowY;
    element.style.maxWidth = prevMaxWidth;
    element.style.maxHeight = prevMaxHeight;
    element.style.width = prevWidth;
    element.style.height = prevHeight;
  }

  // Auto-pick orientation based on aspect ratio so we don't force a wide
  // table into portrait and waste 40% of the page on whitespace.
  const pickedOrientation: 'landscape' | 'portrait' =
    orientation === 'auto'
      ? (canvas.width >= canvas.height ? 'landscape' : 'portrait')
      : orientation;

  const pageW = pickedOrientation === 'landscape' ? 297 : 210;
  const pageH = pickedOrientation === 'landscape' ? 210 : 297;
  const margin = 8;
  const headerH = subtitle ? 12 : 8;
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2 - headerH;

  // Fit BOTH dimensions — single page means we cannot overflow vertically.
  // Take the smaller scale so nothing gets cut; remaining space is just
  // whitespace below the image.
  const scale = Math.min(usableW / canvas.width, usableH / canvas.height);
  const drawW = canvas.width * scale;
  const drawH = canvas.height * scale;
  // Center horizontally if the image is narrower than the usable width.
  const offsetX = margin + (usableW - drawW) / 2;

  const pdf = new jsPDF({ orientation: pickedOrientation, unit: 'mm', format: 'a4' });

  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text(title, margin, margin + 4);
  if (subtitle) {
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text(subtitle, margin, margin + 9);
  }

  const imgData = canvas.toDataURL('image/png');
  pdf.addImage(imgData, 'PNG', offsetX, margin + headerH, drawW, drawH);

  pdf.save(`${filename}.pdf`);
}
