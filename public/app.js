        // Setup PDF.js worker
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        // Real-URL routing helpers (slug map is injected by the Astro page as window.__SLUGS)
        const SLUGS = window.__SLUGS || {};
        const SLUG_TO_ID = Object.fromEntries(Object.entries(SLUGS).map(([id, sl]) => [sl, id]));
        function toolPath(id) { return SLUGS[id] ? '/' + SLUGS[id] + '/' : '/'; }
        function navigate(path) {
            if (location.pathname !== path) history.pushState({}, '', path);
            handleRouting();
            window.scrollTo(0, 0);
        }
        // Client-side navigation for internal tool/home links (everything else loads normally)
        document.addEventListener('click', (e) => {
            const a = e.target.closest && e.target.closest('a[href]');
            if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
            const u = new URL(a.href, location.href);
            if (u.origin !== location.origin) return;
            const key = u.pathname.replace(/^\/|\/$/g, '');
            if (key === '' || SLUG_TO_ID[key]) { e.preventDefault(); navigate(key === '' ? '/' : '/' + key + '/'); }
        });
        function syncSeo(toolId) {
            const t = toolId && TOOLS.find(x => x.id === toolId);
            const seo = window.__SEO || {};
            document.title = t ? `${t.name} Online Free | PDFNest` : (seo.homeTitle || document.title);
            const d = document.querySelector('meta[name="description"]');
            if (d) d.content = t ? (t.description || '') : (seo.homeDesc || d.content);
            const c = document.querySelector('link[rel="canonical"]');
            if (c) c.href = location.origin + location.pathname;
            const block = document.getElementById('seoContent');
            if (block) block.hidden = location.pathname !== window.__INITIAL_PATH;
        }

        // Global State
        const STATE = {
            currentRoute: '#/',
            currentCategory: 'All',
            searchQuery: '',
            favorites: JSON.parse(localStorage.getItem('pdfnest_favorites') || '[]'),
            recents: JSON.parse(localStorage.getItem('pdfnest_recents') || '[]'),
            theme: localStorage.getItem('pdfnest_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
            chainedFiles: null // Files passed from previous tool
        };

        const CATEGORIES = [
            { id: 'All', name: 'All Tools', icon: '⚡' },
            { id: 'Organize', name: 'Organize', icon: '📂' },
            { id: 'Optimize', name: 'Optimize', icon: '🗜️' },
            { id: 'Convert to PDF', name: 'Convert to PDF', icon: '📥' },
            { id: 'Convert from PDF', name: 'Convert from PDF', icon: '📤' },
            { id: 'Edit & Security', name: 'Edit & Security', icon: '🔒' },
            { id: 'AI Features', name: 'AI Features', icon: '✨' }
        ];

        // Central Registry of Tools
        const TOOLS = [
            // ORGANIZE TOOLS
            {
                id: 'merge',
                name: 'Merge PDF',
                category: 'Organize',
                icon: '🧩',
                description: 'Combine multiple PDF files into one single document in any custom order.',
                accept: '.pdf',
                multiple: true,
                options: [],
                run: async (files, opts, ctx) => {
                    const { PDFDocument } = PDFLib;
                    const mergedPdf = await PDFDocument.create();
                    for (let i = 0; i < files.length; i++) {
                        ctx.updateProgress((i / files.length) * 100, `Merging ${files[i].name}...`);
                        const bytes = await files[i].arrayBuffer();
                        const doc = await PDFDocument.load(bytes);
                        const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
                        copiedPages.forEach(page => mergedPdf.addPage(page));
                    }
                    ctx.updateProgress(100, 'Finalizing merged PDF...');
                    const pdfBytes = await mergedPdf.save();
                    return new File([pdfBytes], 'merged_document.pdf', { type: 'application/pdf' });
                }
            },
            {
                id: 'split',
                name: 'Split PDF',
                category: 'Organize',
                icon: '✂️',
                description: 'Split a PDF document by specific page ranges or into individual page files.',
                accept: '.pdf',
                multiple: false,
                options: [
                    { id: 'mode', label: 'Split Mode', type: 'select', values: ['Range', 'Every N Pages'], default: 'Range' },
                    { id: 'range', label: 'Page Range (e.g. 1-3, 5, 7-9)', type: 'text', default: '1-2' },
                    { id: 'everyN', label: 'Split every N pages', type: 'number', default: 1 }
                ],
                run: async (files, opts, ctx) => {
                    const { PDFDocument } = PDFLib;
                    const bytes = await files[0].arrayBuffer();
                    const srcDoc = await PDFDocument.load(bytes);
                    const totalPages = srcDoc.getPageCount();
                    const zip = new JSZip();

                    if (opts.mode === 'Every N Pages') {
                        const step = Math.max(1, parseInt(opts.everyN) || 1);
                        let part = 1;
                        for (let i = 0; i < totalPages; i += step) {
                            ctx.updateProgress((i / totalPages) * 100, `Splitting part ${part}...`);
                            const newDoc = await PDFDocument.create();
                            const pageIndices = Array.from({ length: Math.min(step, totalPages - i) }, (_, idx) => i + idx);
                            const pages = await newDoc.copyPages(srcDoc, pageIndices);
                            pages.forEach(p => newDoc.addPage(p));
                            const splitBytes = await newDoc.save();
                            zip.file(`split_part_${part}.pdf`, splitBytes);
                            part++;
                        }
                    } else {
                        // Range mode parse
                        const pageIndices = parsePageRanges(opts.range, totalPages);
                        if (pageIndices.length === 0) throw new Error('Invalid page range specified.');
                        const newDoc = await PDFDocument.create();
                        const pages = await newDoc.copyPages(srcDoc, pageIndices);
                        pages.forEach(p => newDoc.addPage(p));
                        const splitBytes = await newDoc.save();
                        return new File([splitBytes], 'split_range.pdf', { type: 'application/pdf' });
                    }

                    ctx.updateProgress(100, 'Creating ZIP archive...');
                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    return new File([zipBlob], 'split_pages.zip', { type: 'application/zip' });
                }
            },
            {
                id: 'extract',
                name: 'Extract Pages',
                category: 'Organize',
                icon: '📄',
                description: 'Select and extract only specific pages into a brand new PDF document.',
                accept: '.pdf',
                multiple: false,
                hasVisualSelector: true,
                options: [
                    { id: 'pages', label: 'Page Selection (e.g. 1, 3-5)', type: 'text', default: '1' }
                ],
                run: async (files, opts, ctx) => {
                    const { PDFDocument } = PDFLib;
                    const bytes = await files[0].arrayBuffer();
                    const srcDoc = await PDFDocument.load(bytes);
                    const totalPages = srcDoc.getPageCount();
                    
                    const indices = ctx.selectedPages.length ? ctx.selectedPages : parsePageRanges(opts.pages, totalPages);
                    if (!indices.length) throw new Error('No pages selected for extraction.');

                    const newDoc = await PDFDocument.create();
                    const pages = await newDoc.copyPages(srcDoc, indices);
                    pages.forEach(p => newDoc.addPage(p));

                    const pdfBytes = await newDoc.save();
                    return new File([pdfBytes], 'extracted_pages.pdf', { type: 'application/pdf' });
                }
            },
            {
                id: 'remove',
                name: 'Remove Pages',
                category: 'Organize',
                icon: '🗑️',
                description: 'Delete unwanted pages from your document visually or by page numbers.',
                accept: '.pdf',
                multiple: false,
                hasVisualSelector: true,
                options: [
                    { id: 'pages', label: 'Pages to Remove (e.g. 2, 4-6)', type: 'text', default: '2' }
                ],
                run: async (files, opts, ctx) => {
                    const { PDFDocument } = PDFLib;
                    const bytes = await files[0].arrayBuffer();
                    const srcDoc = await PDFDocument.load(bytes);
                    const totalPages = srcDoc.getPageCount();

                    let removeSet = new Set(ctx.selectedPages.length ? ctx.selectedPages : parsePageRanges(opts.pages, totalPages));
                    const keepIndices = [];
                    for (let i = 0; i < totalPages; i++) {
                        if (!removeSet.has(i)) keepIndices.push(i);
                    }

                    if (keepIndices.length === 0) throw new Error('Cannot remove all pages from PDF.');

                    const newDoc = await PDFDocument.create();
                    const pages = await newDoc.copyPages(srcDoc, keepIndices);
                    pages.forEach(p => newDoc.addPage(p));

                    const pdfBytes = await newDoc.save();
                    return new File([pdfBytes], 'cleaned_document.pdf', { type: 'application/pdf' });
                }
            },
            {
                id: 'reorder',
                name: 'Reorder / Organize Pages',
                category: 'Organize',
                icon: '🔀',
                description: 'Visually drag and drop thumbnails to reorder pages and export the modified PDF.',
                accept: '.pdf',
                multiple: false,
                hasVisualReorder: true,
                options: [],
                run: async (files, opts, ctx) => {
                    const { PDFDocument } = PDFLib;
                    const bytes = await files[0].arrayBuffer();
                    const srcDoc = await PDFDocument.load(bytes);
                    
                    const newIndices = ctx.pageOrder || Array.from({ length: srcDoc.getPageCount() }, (_, i) => i);
                    const newDoc = await PDFDocument.create();
                    const pages = await newDoc.copyPages(srcDoc, newIndices);
                    pages.forEach(p => newDoc.addPage(p));

                    const pdfBytes = await newDoc.save();
                    return new File([pdfBytes], 'reordered_document.pdf', { type: 'application/pdf' });
                }
            },
            {
                id: 'rotate',
                name: 'Rotate PDF',
                category: 'Organize',
                icon: '🔄',
                description: 'Rotate PDF pages clockwise or counter-clockwise (90°, 180°, or 270°).',
                accept: '.pdf',
                multiple: false,
                options: [
                    { id: 'angle', label: 'Rotation Angle', type: 'select', values: ['90° Right', '180° Flip', '270° Left'], default: '90° Right' }
                ],
                run: async (files, opts, ctx) => {
                    const { PDFDocument, degrees } = PDFLib;
                    const bytes = await files[0].arrayBuffer();
                    const doc = await PDFDocument.load(bytes);
                    
                    let deg = 90;
                    if (opts.angle.includes('180')) deg = 180;
                    if (opts.angle.includes('270')) deg = 270;

                    const pages = doc.getPages();
                    pages.forEach(p => {
                        const current = p.getRotation().angle;
                        p.setRotation(degrees((current + deg) % 360));
                    });

                    const pdfBytes = await doc.save();
                    return new File([pdfBytes], 'rotated_document.pdf', { type: 'application/pdf' });
                }
            },

            // OPTIMIZE TOOLS
            {
                id: 'compress',
                name: 'Compress PDF',
                category: 'Optimize',
                icon: '🗜️',
                description: 'Reduce file size by re-rendering document pages at optimized JPEG compression quality levels.',
                accept: '.pdf',
                multiple: false,
                options: [
                    { id: 'quality', label: 'Compression Level', type: 'select', values: ['Extreme (Low Quality)', 'Recommended (Medium)', 'Less Compression (High Quality)'], default: 'Recommended (Medium)' }
                ],
                run: async (files, opts, ctx) => {
                    const arrayBuffer = await files[0].arrayBuffer();
                    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    const totalPages = pdfDoc.numPages;

                    let scale = 1.2;
                    let quality = 0.65;
                    if (opts.quality.includes('Extreme')) { scale = 0.9; quality = 0.45; }
                    if (opts.quality.includes('Less')) { scale = 1.5; quality = 0.85; }

                    const { jsPDF } = window.jspdf;
                    let outPdf = null;

                    for (let i = 1; i <= totalPages; i++) {
                        ctx.updateProgress((i / totalPages) * 100, `Compressing page ${i} of ${totalPages}...`);
                        const page = await pdfDoc.getPage(i);
                        const base = page.getViewport({ scale: 1 });
                        const viewport = page.getViewport({ scale });
                        
                        const canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        const canvasCtx = canvas.getContext('2d');
                        
                        await page.render({ canvasContext: canvasCtx, viewport }).promise;
                        const imgData = canvas.toDataURL('image/jpeg', quality);

                        const orientation = base.width > base.height ? 'l' : 'p';
                        if (i === 1) {
                            outPdf = new jsPDF({ orientation, unit: 'pt', format: [base.width, base.height] });
                        } else {
                            outPdf.addPage([base.width, base.height], orientation);
                        }
                        outPdf.addImage(imgData, 'JPEG', 0, 0, base.width, base.height);
                    }

                    const pdfBlob = outPdf.output('blob');
                    pdfDoc.destroy();
                    if (pdfBlob.size >= files[0].size) {
                        showToast('File is already optimized', 'info');
                        const same = new File([files[0]], files[0].name, { type: 'application/pdf' });
                        same.origSize = files[0].size;
                        return same;
                    }
                    const res = new File([pdfBlob], 'compressed_document.pdf', { type: 'application/pdf' });
                    res.origSize = files[0].size;
                    return res;
                }
            },

            // CONVERT TO PDF TOOLS
            {
                id: 'img-to-pdf',
                name: 'JPG / PNG to PDF',
                category: 'Convert to PDF',
                icon: '🖼️',
                description: 'Convert images (JPG, PNG, WebP) into a beautiful PDF document with configurable margins.',
                accept: 'image/jpeg,image/png,image/webp',
                multiple: true,
                options: [
                    { id: 'orientation', label: 'Page Orientation', type: 'select', values: ['Auto', 'Portrait', 'Landscape'], default: 'Auto' },
                    { id: 'margin', label: 'Margin', type: 'select', values: ['None', 'Small', 'Big'], default: 'Small' }
                ],
                run: async (files, opts, ctx) => {
                    const { jsPDF } = window.jspdf;
                    let doc = null;

                    let margin = 0;
                    if (opts.margin === 'Small') margin = 20;
                    if (opts.margin === 'Big') margin = 40;

                    for (let i = 0; i < files.length; i++) {
                        ctx.updateProgress((i / files.length) * 100, `Processing image ${i + 1}...`);
                        const img = await loadImage(await readFileAsDataURL(files[i]));
                        const cv = document.createElement('canvas');
                        cv.width = img.width; cv.height = img.height;
                        const cx = cv.getContext('2d');
                        cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0);
                        const imgData = cv.toDataURL('image/jpeg', 0.92);

                        let orientation = opts.orientation.toLowerCase();
                        if (orientation === 'auto') {
                            orientation = img.width > img.height ? 'landscape' : 'portrait';
                        }

                        let pageWidth, pageHeight;
                        if (opts.pageSize === 'Fit to image') {
                            const k = Math.min(1, 842 / Math.max(img.width, img.height));
                            pageWidth = img.width * k + margin * 2; pageHeight = img.height * k + margin * 2;
                            orientation = pageWidth > pageHeight ? 'landscape' : 'portrait';
                        } else {
                            const [bw, bh] = opts.pageSize === 'Letter' ? [612, 792] : [595.28, 841.89];
                            pageWidth = orientation === 'portrait' ? bw : bh; pageHeight = orientation === 'portrait' ? bh : bw;
                        }

                        if (i === 0) {
                            doc = new jsPDF({ orientation, unit: 'pt', format: [pageWidth, pageHeight] });
                        } else {
                            doc.addPage([pageWidth, pageHeight], orientation);
                        }

                        const availWidth = pageWidth - margin * 2;
                        const availHeight = pageHeight - margin * 2;
                        const ratio = Math.min(availWidth / img.width, availHeight / img.height);
                        const renderWidth = img.width * ratio;
                        const renderHeight = img.height * ratio;
                        const x = (pageWidth - renderWidth) / 2;
                        const y = (pageHeight - renderHeight) / 2;

                        doc.addImage(imgData, 'JPEG', x, y, renderWidth, renderHeight);
                    }

                    const blob = doc.output('blob');
                    return new File([blob], 'images_converted.pdf', { type: 'application/pdf' });
                }
            },
            {
                id: 'docx-to-pdf',
                name: 'Word (DOCX) to PDF',
                category: 'Convert to PDF',
                icon: '📝',
                description: 'Convert Microsoft Word (.docx) documents cleanly into PDF directly in browser.',
                accept: '.docx',
                multiple: false,
                options: [],
                run: async (files, opts, ctx) => {
                    ctx.updateProgress(30, 'Extracting text and structure from DOCX...');
                    const arrayBuffer = await files[0].arrayBuffer();
                    const result = await mammoth.extractRawText({ arrayBuffer });
                    const text = result.value;

                    ctx.updateProgress(70, 'Generating PDF formatting...');
                    const { jsPDF } = window.jspdf;
                    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
                    
                    const lines = doc.splitTextToSize(text, 500);
                    let y = 50;
                    lines.forEach((line) => {
                        if (y > 780) {
                            doc.addPage();
                            y = 50;
                        }
                        doc.text(line, 45, y);
                        y += 18;
                    });

                    const blob = doc.output('blob');
                    return new File([blob], `${files[0].name.replace('.docx', '')}.pdf`, { type: 'application/pdf' });
                }
            },
            {
                id: 'txt-to-pdf',
                name: 'Text to PDF',
                category: 'Convert to PDF',
                icon: '🔤',
                description: 'Convert plain text files (.txt) into formatted, downloadable PDF documents.',
                accept: '.txt',
                multiple: false,
                options: [
                    { id: 'fontSize', label: 'Font Size', type: 'select', values: ['10', '12', '14'], default: '12' }
                ],
                run: async (files, opts, ctx) => {
                    const text = await files[0].text();
                    const { jsPDF } = window.jspdf;
                    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
                    doc.setFont('Helvetica');
                    doc.setFontSize(parseInt(opts.fontSize) || 12);

                    const lines = doc.splitTextToSize(text, 510);
                    let y = 50;
                    lines.forEach((line) => {
                        if (y > 780) {
                            doc.addPage();
                            y = 50;
                        }
                        doc.text(line, 40, y);
                        y += 16;
                    });

                    const blob = doc.output('blob');
                    return new File([blob], `${files[0].name.replace('.txt', '')}.pdf`, { type: 'application/pdf' });
                }
            },

            // CONVERT FROM PDF TOOLS
            {
                id: 'pdf-to-img',
                name: 'PDF to JPG / PNG',
                category: 'Convert from PDF',
                icon: '🖼️',
                description: 'Render every page of your PDF into high-definition images packed inside a ZIP file.',
                accept: '.pdf',
                multiple: false,
                options: [
                    { id: 'format', label: 'Image Format', type: 'select', values: ['PNG', 'JPEG'], default: 'PNG' },
                    { id: 'dpi', label: 'Quality / Scale', type: 'select', values: ['Standard (1x)', 'High Quality (2x)', 'Ultra (3x)'], default: 'High Quality (2x)' }
                ],
                run: async (files, opts, ctx) => {
                    const arrayBuffer = await files[0].arrayBuffer();
                    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    const zip = new JSZip();

                    let scale = 2.0;
                    if (opts.dpi.includes('1x')) scale = 1.0;
                    if (opts.dpi.includes('3x')) scale = 3.0;

                    const ext = opts.format.toLowerCase();
                    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

                    for (let i = 1; i <= pdfDoc.numPages; i++) {
                        ctx.updateProgress((i / pdfDoc.numPages) * 100, `Rendering page ${i} as image...`);
                        const page = await pdfDoc.getPage(i);
                        const viewport = page.getViewport({ scale });

                        const canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        const canvasCtx = canvas.getContext('2d');

                        await page.render({ canvasContext: canvasCtx, viewport }).promise;
                        const dataUrl = canvas.toDataURL(mime, 0.92);
                        const base64Data = dataUrl.split(',')[1];

                        zip.file(`page_${i}.${ext}`, base64Data, { base64: true });
                    }

                    ctx.updateProgress(100, 'Packing images into ZIP...');
                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    return new File([zipBlob], `${files[0].name.replace('.pdf', '')}_images.zip`, { type: 'application/zip' });
                }
            },
            {
                id: 'pdf-to-txt',
                name: 'PDF to Text',
                category: 'Convert from PDF',
                icon: '📄',
                description: 'Extract raw text content from all pages of a PDF document into a TXT file.',
                accept: '.pdf',
                multiple: false,
                options: [],
                run: async (files, opts, ctx) => {
                    const arrayBuffer = await files[0].arrayBuffer();
                    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    let fullText = '';

                    for (let i = 1; i <= pdfDoc.numPages; i++) {
                        ctx.updateProgress((i / pdfDoc.numPages) * 100, `Extracting page ${i}...`);
                        const page = await pdfDoc.getPage(i);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(item => item.str).join(' ');
                        fullText += `--- Page ${i} ---\n\n${pageText}\n\n`;
                    }

                    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
                    return new File([blob], `${files[0].name.replace('.pdf', '')}_text.txt`, { type: 'text/plain' });
                }
            },

            // EDIT & SECURITY TOOLS
            {
                id: 'page-numbers',
                name: 'Add Page Numbers',
                category: 'Edit & Security',
                icon: '🔢',
                description: 'Stamp customized page numbers onto every page of your PDF file.',
                accept: '.pdf',
                multiple: false,
                options: [
                    { id: 'position', label: 'Position', type: 'select', values: ['Bottom Center', 'Bottom Right', 'Top Right'], default: 'Bottom Center' },
                    { id: 'format', label: 'Format', type: 'select', values: ['Page X', 'Page X of Y', 'X'], default: 'Page X of Y' }
                ],
                run: async (files, opts, ctx) => {
                    const { PDFDocument, rgb, StandardFonts } = PDFLib;
                    const bytes = await files[0].arrayBuffer();
                    const doc = await PDFDocument.load(bytes);
                    const font = await doc.embedFont(StandardFonts.Helvetica);
                    const totalPages = doc.getPageCount();

                    doc.getPages().forEach((page, idx) => {
                        const { width, height } = page.getSize();
                        const num = idx + 1;
                        let textStr = `Page ${num}`;
                        if (opts.format === 'Page X of Y') textStr = `Page ${num} of ${totalPages}`;
                        if (opts.format === 'X') textStr = `${num}`;

                        const textWidth = font.widthOfTextAtSize(textStr, 10);
                        let x = (width - textWidth) / 2;
                        let y = 20;

                        if (opts.position === 'Bottom Right') x = width - textWidth - 30;
                        if (opts.position === 'Top Right') { x = width - textWidth - 30; y = height - 30; }

                        page.drawText(textStr, {
                            x,
                            y,
                            size: 10,
                            font,
                            color: rgb(0.2, 0.2, 0.2)
                        });
                    });

                    const pdfBytes = await doc.save();
                    return new File([pdfBytes], 'numbered_document.pdf', { type: 'application/pdf' });
                }
            },
            {
                id: 'watermark',
                name: 'Add Watermark',
                category: 'Edit & Security',
                icon: '🌊',
                description: 'Overlay custom text watermarks across PDF pages with rotation and transparency controls.',
                accept: '.pdf',
                multiple: false,
                options: [
                    { id: 'text', label: 'Watermark Text', type: 'text', default: 'CONFIDENTIAL' },
                    { id: 'opacity', label: 'Opacity', type: 'select', values: ['0.1', '0.25', '0.5', '0.75'], default: '0.25' },
                    { id: 'color', label: 'Color', type: 'color', default: '#b31a1a' },
                    { id: 'fontSize', label: 'Font size (0 = auto)', type: 'number', default: 0 }
                ],
                run: async (files, opts, ctx) => {
                    const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;
                    const bytes = await files[0].arrayBuffer();
                    const doc = await PDFDocument.load(bytes);
                    const font = await doc.embedFont(StandardFonts.HelveticaBold);
                    const text = opts.text || 'CONFIDENTIAL';
                    const opacity = parseFloat(opts.opacity) || 0.25;
                    const hx = (opts.color || '#b31a1a').replace('#', '');
                    const col = rgb(parseInt(hx.slice(0, 2), 16) / 255, parseInt(hx.slice(2, 4), 16) / 255, parseInt(hx.slice(4, 6), 16) / 255);
                    const th = Math.PI / 4;
                    doc.getPages().forEach((page) => {
                        const { width: W, height: H } = page.getSize();
                        const diag = Math.hypot(W, H);
                        let fs = parseFloat(opts.fontSize) > 0 ? parseFloat(opts.fontSize) : Math.min(W, H) / 8;
                        let w;
                        try { w = font.widthOfTextAtSize(text, fs); }
                        catch (e) { throw new Error('Watermark has unsupported characters (only Latin/WinAnsi text is supported).'); }
                        if (w > diag * 0.8) { fs *= diag * 0.8 / w; w = font.widthOfTextAtSize(text, fs); }
                        const h = fs * 0.35;
                        page.drawText(text, {
                            x: W / 2 - (w / 2) * Math.cos(th) + (h / 2) * Math.sin(th),
                            y: H / 2 - (w / 2) * Math.sin(th) - (h / 2) * Math.cos(th),
                            size: fs, font, color: col, opacity, rotate: degrees(45)
                        });
                    });

                    const pdfBytes = await doc.save();
                    return new File([pdfBytes], 'watermarked_document.pdf', { type: 'application/pdf' });
                }
            },
            {
                id: 'protect',
                name: 'Protect PDF',
                category: 'Edit & Security',
                icon: '🔒',
                description: 'Encrypt your PDF document with a strong password to restrict viewing.',
                accept: '.pdf',
                multiple: false,
                options: [
                    { id: 'password', label: 'Password', type: 'password', default: '' },
                    { id: 'confirm', label: 'Confirm Password', type: 'password', default: '' }
                ],
                run: async (files, opts, ctx) => {
                    if (!opts.password) throw new Error('Please specify a password to protect the document.');
                    if (opts.password !== opts.confirm) throw new Error('Passwords do not match.');
                    const { PDFDocument } = PDFLib;
                    const bytes = await files[0].arrayBuffer();
                    const doc = await PDFDocument.load(bytes);

                    doc.encrypt({
                        userPassword: opts.password,
                        ownerPassword: opts.password,
                        permissions: { printing: 'highResolution', modifying: false, copying: false }
                    });

                    const pdfBytes = await doc.save();
                    return new File([pdfBytes], 'protected_document.pdf', { type: 'application/pdf' });
                }
            },
            {
                id: 'unlock',
                name: 'Unlock PDF',
                category: 'Edit & Security',
                icon: '🔓',
                description: 'Remove password protection from encrypted PDF documents.',
                accept: '.pdf',
                multiple: false,
                options: [
                    { id: 'password', label: 'Current Password', type: 'text', default: '' }
                ],
                run: async (files, opts, ctx) => {
                    const { PDFDocument } = PDFLib;
                    const bytes = await files[0].arrayBuffer();
                    
                    let doc;
                    try {
                        await unlockPrecheck(PDFDocument, bytes);
                        doc = await PDFDocument.load(bytes, { password: opts.password });
                    } catch (e) {
                        throw e.notEncrypted ? e : new Error('Incorrect password');
                    }

                    const pdfBytes = await doc.save();
                    return new File([pdfBytes], 'unlocked_document.pdf', { type: 'application/pdf' });
                }
            },

            // AI FEATURES
            {
                id: 'ai-summarize',
                name: 'AI Summarize PDF',
                category: 'AI Features',
                icon: '✨',
                description: 'Extract document text and generate key takeaways and concise summary using Gemini AI.',
                accept: '.pdf',
                multiple: false,
                options: [],
                run: async (files, opts, ctx) => {
                    checkGeminiApiKey();
                    ctx.updateProgress(20, 'Extracting document text...');
                    const text = await extractTextFromPdf(files[0]);

                    ctx.updateProgress(50, 'Sending text to Gemini AI model...');
                    const base = 'Summarize the following content into structured bullet points (Executive Summary, Key Highlights, Action Items):\n\n';
                    const parts = chunkText(text, 12000);
                    const sums = [];
                    for (let i = 0; i < parts.length; i++) {
                        ctx.updateProgress(50 + 40 * i / parts.length, `Summarizing part ${i + 1}/${parts.length}...`);
                        sums.push(await callGeminiApi(base + parts[i]));
                    }
                    const summaryResult = parts.length === 1 ? sums[0] : await callGeminiApi(base + sums.join('\n\n'));

                    // Generate downloadable TXT report
                    const blob = new Blob([summaryResult], { type: 'text/plain;charset=utf-8' });
                    const file = new File([blob], `${files[0].name.replace('.pdf', '')}_summary.txt`, { type: 'text/plain' });
                    file.aiText = summaryResult; // Attach raw AI output for rendering on UI
                    return file;
                }
            },
            {
                id: 'ai-chat',
                name: 'Chat with PDF',
                category: 'AI Features',
                icon: '💬',
                description: 'Ask questions and interactively chat with your PDF content with page citations.',
                accept: '.pdf',
                multiple: false,
                isInteractiveAi: true,
                options: [],
                run: async (files, opts, ctx) => {
                    checkGeminiApiKey();
                    ctx.updateProgress(50, 'Parsing text and indexing document pages...');
                    const pagesText = await extractTextPagesFromPdf(files[0]);
                    return { pagesText, fileName: files[0].name };
                }
            },
            {
                id: 'ai-translate',
                name: 'Translate PDF Text',
                category: 'AI Features',
                icon: '🌐',
                description: 'Translate all document content into another language using Gemini AI.',
                accept: '.pdf',
                multiple: false,
                options: [
                    { id: 'targetLang', label: 'Target Language', type: 'select', values: ['Spanish', 'French', 'German', 'Japanese', 'Chinese', 'Portuguese', 'Italian', 'Arabic', 'Urdu', 'Hindi', 'Persian', 'Turkish'], default: 'Spanish' }
                ],
                run: async (files, opts, ctx) => {
                    checkGeminiApiKey();
                    ctx.updateProgress(20, 'Reading PDF text...');
                    const text = await extractTextFromPdf(files[0]);

                    ctx.updateProgress(60, `Translating text to ${opts.targetLang}...`);
                    const tparts = chunkText(text, 12000);
                    let translation = '';
                    for (let i = 0; i < tparts.length; i++) {
                        ctx.updateProgress(30 + 65 * i / tparts.length, `Translating part ${i + 1}/${tparts.length}...`);
                        translation += (i ? '\n\n' : '') + await callGeminiApi(`Translate the following text into ${opts.targetLang}. Keep paragraph formatting. Output only the translation:\n\n${tparts[i]}`);
                    }

                    const blob = new Blob([translation], { type: 'text/plain;charset=utf-8' });
                    const file = new File([blob], `${files[0].name.replace('.pdf', '')}_${opts.targetLang}.txt`, { type: 'text/plain' });
                    file.aiText = translation;
                    return file;
                }
            },
            {
                id: 'ocr',
                name: 'OCR Image Reader',
                category: 'AI Features',
                icon: '👁️',
                description: 'Perform optical character recognition on scanned PDFs/images with Tesseract.js.',
                accept: '.pdf,image/*',
                multiple: false,
                options: [],
                run: async (files, opts, ctx) => {
                    ctx.updateProgress(10, 'Initializing Tesseract OCR engine...');
                    let fullText = '';

                    if (files[0].type === 'application/pdf') {
                        const arrayBuffer = await files[0].arrayBuffer();
                        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                        for (let i = 1; i <= Math.min(pdfDoc.numPages, 5); i++) {
                            ctx.updateProgress(10 + (i / pdfDoc.numPages) * 80, `Running OCR on page ${i}...`);
                            const page = await pdfDoc.getPage(i);
                            const viewport = page.getViewport({ scale: 1.5 });
                            const canvas = document.createElement('canvas');
                            canvas.width = viewport.width;
                            canvas.height = viewport.height;
                            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

                            const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
                            fullText += `--- OCR Page ${i} ---\n${text}\n\n`;
                        }
                    } else {
                        const { data: { text } } = await Tesseract.recognize(files[0], 'eng', {
                            logger: m => {
                                if (m.status === 'recognizing text') {
                                    ctx.updateProgress(Math.round(m.progress * 100), `OCR Processing... ${Math.round(m.progress * 100)}%`);
                                }
                            }
                        });
                        fullText = text;
                    }

                    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
                    const file = new File([blob], 'ocr_extracted_text.txt', { type: 'text/plain' });
                    file.aiText = fullText;
                    return file;
                }
            },

            // STUB / COMING SOON TOOLS (Registry Completeness)
            ...[
                { id: 'crop', name: 'Crop PDF', category: 'Organize', icon: '✂️' },
                { id: 'redact', name: 'Redact PDF', category: 'Edit & Security', icon: '⬛' },
                { id: 'sign', name: 'Sign PDF', category: 'Edit & Security', icon: '✍️' },
                { id: 'edit-text', name: 'Edit PDF Text', category: 'Edit & Security', icon: '✏️' },
                { id: 'compare', name: 'Compare PDFs', category: 'Organize', icon: '⚖️' },
                { id: 'flatten', name: 'Flatten Forms', category: 'Edit & Security', icon: '📋' },
                { id: 'repair', name: 'Repair PDF', category: 'Optimize', icon: '🛠️' },
                { id: 'pdf-to-word', name: 'PDF to Word', category: 'Convert from PDF', icon: '📄' },
                { id: 'pdf-to-excel', name: 'PDF to Excel', category: 'Convert from PDF', icon: '📊' },
                { id: 'excel-to-pdf', name: 'Excel to PDF', category: 'Convert to PDF', icon: '📈' },
                { id: 'pdfa', name: 'PDF/A Converter', category: 'Convert to PDF', icon: '🏛️' },
                { id: 'header-footer', name: 'Header & Footer', category: 'Edit & Security', icon: '📌' },
                { id: 'metadata', name: 'Metadata Editor', category: 'Edit & Security', icon: '🏷️' },
                { id: 'grayscale', name: 'Grayscale PDF', category: 'Optimize', icon: '⚪' },
                { id: 'extract-images', name: 'Extract Images', category: 'Convert from PDF', icon: '📸' },
                { id: 'blank-page-remover', name: 'Remove Blank Pages', category: 'Organize', icon: '🧹' },
                { id: 'ai-rewrite', name: 'AI Tone Rewriter', category: 'AI Features', icon: '✍️' },
                { id: 'ai-quiz', name: 'AI Quiz Generator', category: 'AI Features', icon: '❓' },
                { id: 'ai-table', name: 'AI Extract Tables', category: 'AI Features', icon: '▦' },
                { id: 'ai-redact-smart', name: 'AI Smart Redaction', category: 'AI Features', icon: '🕵️' }
            ].map(stub => ({
                id: stub.id,
                name: stub.name,
                category: stub.category,
                icon: stub.icon,
                description: `${stub.name} tool module is scheduled for upcoming release.`,
                isStub: true
            }))
        ];

        // ===== PATCH: helpers =====
        function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
        function renderMd(s){return escapeHtml(s).replace(/^#{1,6}\s+(.*)$/gm,'<strong class="text-sm">$1</strong>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/^\s*[*-]\s+/gm,'• ');}
        function fmtSize(b){return b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(2)+' MB';}
        function fileMatchesAccept(f,accept){return accept.split(',').some(a=>{a=a.trim().toLowerCase();return a.startsWith('.')?f.name.toLowerCase().endsWith(a):a.endsWith('/*')?f.type.startsWith(a.slice(0,-1)):f.type===a;});}
        function friendlyError(err){const m=String(err&&err.message||err);if(/encrypt/i.test(m))return 'This PDF is password-protected. Unlock it first.';if(/No PDF header|Invalid PDF|Failed to parse|corrupt|XRef|Unexpected/i.test(m))return 'This file looks corrupted or is not a valid PDF. Try the Repair tool.';return m||'Something went wrong.';}
        function chunkText(t,n){const o=[];for(let i=0;i<t.length;i+=n)o.push(t.slice(i,i+n));return o.length?o:[''];}
        const STOPWORDS='the and for are but not you all can was were what when where which who how why this that with from have has had will would could should about into than then them they their there here your our its is it of to in on at by an or as be a i me my we do does did'.split(' ');
        async function unlockPrecheck(PDFDocument,bytes){let d;try{d=await PDFDocument.load(bytes);}catch(e){return;}if(!d.isEncrypted){const e=new Error('This PDF is not password-protected.');e.notEncrypted=true;throw e;}}
        function checkLibs(){const libs={pdfjsLib:window.pdfjsLib,PDFLib:window.PDFLib,jspdf:window.jspdf,JSZip:window.JSZip,saveAs:window.saveAs,Tesseract:window.Tesseract,mammoth:window.mammoth,Sortable:window.Sortable};Object.entries(libs).forEach(([n,v])=>{if(!v){const d=document.createElement('div');d.className='p-4 rounded-xl border bg-red-50 border-red-200 text-red-700 text-sm pointer-events-auto';d.textContent='Library failed to load: '+n+'. Check your connection and reload.';document.getElementById('toastContainer').appendChild(d);}});}
        document.addEventListener('keydown',e=>{const pal=document.getElementById('commandPalette');if(!pal||pal.classList.contains('hidden'))return;const items=[...document.querySelectorAll('#cmdList a')];if(!items.length)return;let i=items.findIndex(a=>a.dataset.active);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(i>=0){delete items[i].dataset.active;items[i].classList.remove('bg-slate-100');}i=e.key==='ArrowDown'?(i+1)%items.length:(i-1+items.length)%items.length;items[i].dataset.active=1;items[i].classList.add('bg-slate-100');items[i].scrollIntoView({block:'nearest'});}else if(e.key==='Enter'){items[i>=0?i:0].click();}});

        // ===== NEW TOOLS =====
        const loadPdf=async f=>PDFLib.PDFDocument.load(await f.arrayBuffer(),{ignoreEncryption:true});
        const pdfOut=(b,n)=>new File([b],n,{type:'application/pdf'});
        const baseName=f=>f.name.replace(/\.[^.]+$/,'');
        const aiFile=(t,n,mime='text/plain')=>{const f=new File([new Blob([t],{type:mime+';charset=utf-8'})],n,{type:mime});f.aiText=t;return f;};
        async function renderPageCanvas(pdf,n,scale){const p=await pdf.getPage(n);const vp=p.getViewport({scale});const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;await p.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;return c;}
        const aiTool=(id,name,icon,desc,options,promptFn,outName,mime='text/plain',chunked=false,post=s=>s)=>({id,name,category:'AI Features',icon,description:desc,accept:'.pdf',multiple:false,options,
            run:async(files,opts,ctx)=>{checkGeminiApiKey();ctx.updateProgress(15,'Reading PDF text...');const text=await extractTextFromPdf(files[0]);if(!text.trim())throw new Error('No selectable text found. Run OCR first.');
                const parts=chunked?chunkText(text,12000):[text.slice(0,12000)];let out='';
                for(let i=0;i<parts.length;i++){ctx.updateProgress(20+70*i/parts.length,`Gemini: part ${i+1}/${parts.length}...`);out+=(i?'\n\n':'')+await callGeminiApi(promptFn(parts[i],opts));}
                return aiFile(post(out),`${baseName(files[0])}_${outName}`,mime);}});
        const NEW_TOOLS=[
            {id:'crop',name:'Crop PDF',category:'Organize',icon:'✂️',description:'Trim margins from every page by a set number of points.',accept:'.pdf',multiple:false,
             options:['top','right','bottom','left'].map(s=>({id:s,label:`${s[0].toUpperCase()+s.slice(1)} margin (pt)`,type:'number',default:20})),
             run:async(files,o)=>{const doc=await loadPdf(files[0]);const [t,r,b,l]=['top','right','bottom','left'].map(k=>Math.max(0,parseFloat(o[k])||0));
                doc.getPages().forEach(p=>{const{width:w,height:h}=p.getSize();if(l+r>=w||t+b>=h)throw new Error('Margins are larger than the page.');p.setCropBox(l,b,w-l-r,h-t-b);});
                return pdfOut(await doc.save(),'cropped_document.pdf');}},
            {id:'flatten',name:'Flatten Forms',category:'Edit & Security',icon:'📋',description:'Turn fillable form fields into fixed page content.',accept:'.pdf',multiple:false,options:[],
             run:async(files)=>{const doc=await loadPdf(files[0]);doc.getForm().flatten();return pdfOut(await doc.save(),'flattened_document.pdf');}},
            {id:'repair',name:'Repair PDF',category:'Optimize',icon:'🛠️',description:'Rebuild a damaged PDF by copying its readable pages into a clean file.',accept:'.pdf',multiple:false,options:[],
             run:async(files)=>{let src;try{src=await PDFLib.PDFDocument.load(await files[0].arrayBuffer(),{ignoreEncryption:true,throwOnInvalidObject:false});}catch(e){throw new Error('This file is too damaged to repair.');}
                const out=await PDFLib.PDFDocument.create();const pages=await out.copyPages(src,src.getPageIndices());pages.forEach(p=>out.addPage(p));return pdfOut(await out.save(),'repaired_document.pdf');}},
            {id:'metadata',name:'Metadata Editor',category:'Edit & Security',icon:'🏷️',description:'Edit title, author, subject and keywords (blank fields are left unchanged).',accept:'.pdf',multiple:false,
             options:[{id:'title',label:'Title',type:'text',default:''},{id:'author',label:'Author',type:'text',default:''},{id:'subject',label:'Subject',type:'text',default:''},{id:'keywords',label:'Keywords (comma separated)',type:'text',default:''}],
             run:async(files,o)=>{const doc=await loadPdf(files[0]);if(o.title)doc.setTitle(o.title);if(o.author)doc.setAuthor(o.author);if(o.subject)doc.setSubject(o.subject);
                if(o.keywords)doc.setKeywords(o.keywords.split(',').map(s=>s.trim()).filter(Boolean));doc.setModificationDate(new Date());return pdfOut(await doc.save(),'metadata_document.pdf');}},
            {id:'header-footer',name:'Header & Footer',category:'Edit & Security',icon:'📌',description:'Add header/footer text to every page. Use {n} and {total} for page numbers.',accept:'.pdf',multiple:false,
             options:[{id:'header',label:'Header text',type:'text',default:''},{id:'footer',label:'Footer text',type:'text',default:'Page {n} of {total}'},{id:'size',label:'Font size',type:'number',default:10}],
             run:async(files,o)=>{const{StandardFonts,rgb}=PDFLib;const doc=await loadPdf(files[0]);const font=await doc.embedFont(StandardFonts.Helvetica);const size=parseFloat(o.size)||10;const total=doc.getPageCount();
                doc.getPages().forEach((p,i)=>{const{width:W,height:H}=p.getSize();[[o.header,H-30],[o.footer,20]].forEach(([t,y])=>{if(!t)return;const s=t.replace(/\{n\}/g,i+1).replace(/\{total\}/g,total);
                    let w;try{w=font.widthOfTextAtSize(s,size);}catch(e){throw new Error('Header/footer contains unsupported (non-Latin) characters.');}
                    p.drawText(s,{x:(W-w)/2,y,size,font,color:rgb(.2,.2,.2)});});});
                return pdfOut(await doc.save(),'header_footer_document.pdf');}},
            {id:'grayscale',name:'Grayscale PDF',category:'Optimize',icon:'⚪',description:'Convert pages to black & white (rasterizes pages; text becomes non-selectable).',accept:'.pdf',multiple:false,options:[],
             run:async(files,o,ctx)=>{const pdf=await pdfjsLib.getDocument({data:await files[0].arrayBuffer()}).promise;const{jsPDF}=window.jspdf;let out=null;
                for(let i=1;i<=pdf.numPages;i++){ctx.updateProgress(i/pdf.numPages*100,`Page ${i}/${pdf.numPages}...`);const pg=await pdf.getPage(i);const base=pg.getViewport({scale:1});
                    const c=await renderPageCanvas(pdf,i,2);const x=c.getContext('2d');const d=x.getImageData(0,0,c.width,c.height);const a=d.data;
                    for(let k=0;k<a.length;k+=4){const g=.299*a[k]+.587*a[k+1]+.114*a[k+2];a[k]=a[k+1]=a[k+2]=g;}x.putImageData(d,0,0);
                    const fmt=[base.width,base.height],or=base.width>base.height?'l':'p';if(!out)out=new jsPDF({orientation:or,unit:'pt',format:fmt});else out.addPage(fmt,or);
                    out.addImage(c.toDataURL('image/jpeg',.85),'JPEG',0,0,base.width,base.height);}
                pdf.destroy();return pdfOut(out.output('blob'),'grayscale_document.pdf');}},
            {id:'blank-page-remover',name:'Remove Blank Pages',category:'Organize',icon:'🧹',description:'Detect and delete pages that contain (almost) no content.',accept:'.pdf',multiple:false,
             options:[{id:'sens',label:'Sensitivity',type:'select',values:['Low','Normal','High'],default:'Normal'}],
             run:async(files,o,ctx)=>{const thr={Low:.0005,Normal:.002,High:.008}[o.sens];const pdf=await pdfjsLib.getDocument({data:await files[0].arrayBuffer()}).promise;const keep=[];
                for(let i=1;i<=pdf.numPages;i++){ctx.updateProgress(i/pdf.numPages*90,`Scanning page ${i}...`);const c=await renderPageCanvas(pdf,i,.4);const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let ink=0;
                    for(let k=0;k<a.length;k+=4)if(a[k]<235||a[k+1]<235||a[k+2]<235)ink++;if(ink/(a.length/4)>thr)keep.push(i-1);}
                const n=pdf.numPages;pdf.destroy();if(!keep.length)throw new Error('All pages look blank.');if(keep.length===n)throw new Error('No blank pages found.');
                const src=await loadPdf(files[0]);const out=await PDFLib.PDFDocument.create();(await out.copyPages(src,keep)).forEach(p=>out.addPage(p));
                showToast(`Removed ${n-keep.length} blank page(s).`,'success');return pdfOut(await out.save(),'no_blank_pages.pdf');}},
            {id:'compare',name:'Compare PDFs',category:'Organize',icon:'⚖️',description:'Select exactly two PDFs and get a page-by-page text difference report.',accept:'.pdf',multiple:true,options:[],
             run:async(files,o,ctx)=>{if(files.length!==2)throw new Error('Please select exactly two PDF files.');const [A,B]=await Promise.all(files.map(extractTextPagesFromPdf));
                const W=t=>t.toLowerCase().split(/\s+/).filter(Boolean);let rep=`Comparing:\nA: ${files[0].name} (${A.length} pages)\nB: ${files[1].name} (${B.length} pages)\n\n`;let diffs=0;
                for(let i=0;i<Math.max(A.length,B.length);i++){const a=A[i]?.text||'',b=B[i]?.text||'';if(a.trim()===b.trim())continue;diffs++;const sa=new Set(W(a)),sb=new Set(W(b));
                    const rem=[...sa].filter(w=>!sb.has(w)).slice(0,30),add=[...sb].filter(w=>!sa.has(w)).slice(0,30);
                    rep+=`Page ${i+1}: ${!A[i]?'only in B':!B[i]?'only in A':'differs'}\n  removed: ${rem.join(' ')||'-'}\n  added:   ${add.join(' ')||'-'}\n\n`;}
                if(!diffs)rep+='No text differences found.';else rep=`${diffs} page(s) differ.\n\n`+rep;return aiFile(rep,'comparison_report.txt');}},
            aiTool('ai-rewrite','AI Tone Rewriter','✍️','Rewrite the whole document in a different tone using Gemini.',[{id:'tone',label:'Tone',type:'select',values:['Professional','Casual','Simple','Academic','Persuasive'],default:'Professional'}],(t,o)=>`Rewrite the following text in a ${o.tone} tone. Keep the meaning and paragraph structure. Output only the rewritten text:\n\n${t}`,'rewritten.txt','text/plain',true),
            aiTool('ai-quiz','AI Quiz Generator','❓','Generate a multiple-choice quiz with answers from your PDF.',[{id:'count',label:'Number of questions',type:'number',default:10}],(t,o)=>`Create ${Math.min(30,Math.max(1,parseInt(o.count)||10))} multiple-choice questions (A-D) from this text. After each question give "Answer: X" and a one-line explanation:\n\n${t}`,'quiz.txt'),
            aiTool('ai-table','AI Extract Tables','▦','Find tables in the PDF text and export them as CSV (open in Excel).',[],t=>`Extract every table or tabular data from this text as CSV. Output ONLY valid CSV (quote fields containing commas), no commentary. If there are several tables, separate them with a blank line:\n\n${t}`,'tables.csv','text/csv',false,s=>s.replace(/```(?:csv)?/g,'').trim()),
            {id:'ai-rename',name:'AI Smart Rename',category:'AI Features',icon:'🏷️',description:'Let Gemini suggest a descriptive file name based on the content.',accept:'.pdf',multiple:false,options:[],
             run:async(files,o,ctx)=>{checkGeminiApiKey();ctx.updateProgress(30,'Reading...');const t=await extractTextFromPdf(files[0]);if(!t.trim())throw new Error('No selectable text found. Run OCR first.');
                ctx.updateProgress(60,'Asking Gemini...');const n=(await callGeminiApi('Suggest a concise descriptive file name (max 8 words, no extension, only letters, numbers, spaces, hyphens) for this document. Reply with the name only:\n\n'+t.slice(0,6000))).replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,80);
                const f=new File([files[0]],(n||baseName(files[0]))+'.pdf',{type:'application/pdf'});f.aiText='Suggested name: '+f.name;return f;}}
        ];
        NEW_TOOLS.forEach(t=>{const i=TOOLS.findIndex(x=>x.id===t.id);if(i>=0)TOOLS[i]=t;else TOOLS.push(t);});

                // ===== PATCH 2: HTML->PDF engine, OCR, DOCX/TXT/Excel/HTML to PDF =====
        function sanitizeHtml(html){const d=new DOMParser().parseFromString(html,'text/html');d.querySelectorAll('script,iframe,object,embed,link,meta,base').forEach(n=>n.remove());d.querySelectorAll('*').forEach(n=>[...n.attributes].forEach(a=>{if(/^on/i.test(a.name)||/^\s*javascript:/i.test(a.value))n.removeAttribute(a.name);}));return d.body.innerHTML;}
        async function htmlToPdf(html,ctx){
            const host=document.createElement('div');host.dir='auto';
            host.style.cssText='position:fixed;left:-10000px;top:0;width:794px;padding:40px;background:#fff;color:#000;font:14px/1.6 "Noto Naskh Arabic","Noto Sans",Arial,sans-serif;box-sizing:border-box;';
            host.innerHTML='<style>h1{font-size:26px;font-weight:700;margin:12px 0}h2{font-size:21px;font-weight:700;margin:10px 0}h3{font-size:17px;font-weight:700}ul{list-style:disc;padding-inline-start:24px}ol{list-style:decimal;padding-inline-start:24px}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #999;padding:3px 6px;font-size:12px}img{max-width:100%}p{margin:6px 0}</style>'+html;
            document.body.appendChild(host);
            try{
                await document.fonts.ready;
                const {jsPDF}=window.jspdf;const pdf=new jsPDF({unit:'pt',format:'a4'});
                const pw=pdf.internal.pageSize.getWidth(),pageH=1123,total=Math.max(1,Math.ceil(host.scrollHeight/pageH));
                for(let i=0;i<total;i++){
                    ctx.updateProgress(10+85*i/total,`Rendering page ${i+1}/${total}...`);
                    const c=await html2canvas(host,{scale:2,backgroundColor:'#fff',y:i*pageH,height:pageH,windowWidth:794,useCORS:true});
                    if(i)pdf.addPage();pdf.addImage(c.toDataURL('image/jpeg',.92),'JPEG',0,0,pw,pdf.internal.pageSize.getHeight());
                }
                return pdf.output('blob');
            }finally{host.remove();}
        }
        const upsertTool=t=>{const i=TOOLS.findIndex(x=>x.id===t.id);if(i>=0)TOOLS[i]=t;else TOOLS.push(t);};
        const ovTool=(id,patch)=>Object.assign(TOOLS.find(x=>x.id===id),patch);
        const pdfFrom=async(html,name,ctx)=>new File([await htmlToPdf(html,ctx)],name,{type:'application/pdf'});
        ovTool('docx-to-pdf',{description:'Convert Word (.docx) to PDF keeping headings, bold, lists, tables. Urdu/Arabic supported.',run:async(files,o,ctx)=>{
            ctx.updateProgress(5,'Reading DOCX...');const r=await mammoth.convertToHtml({arrayBuffer:await files[0].arrayBuffer()});
            return pdfFrom(sanitizeHtml(r.value),baseName(files[0])+'.pdf',ctx);}});
        ovTool('txt-to-pdf',{description:'Convert plain text to PDF. Urdu/Arabic supported.',run:async(files,o,ctx)=>{
            const t=await files[0].text();return pdfFrom(`<pre style="white-space:pre-wrap;font:inherit;font-size:${parseInt(o.fontSize)||12}px">${escapeHtml(t)}</pre>`,baseName(files[0])+'.pdf',ctx);}});
        upsertTool({id:'html-to-pdf',name:'HTML to PDF',category:'Convert to PDF',icon:'🌐',description:'Render an .html file as a PDF (scripts are removed).',accept:'.html,.htm',multiple:false,options:[],
            run:async(files,o,ctx)=>pdfFrom(sanitizeHtml(await files[0].text()),baseName(files[0])+'.pdf',ctx)});
        upsertTool({id:'excel-to-pdf',name:'Excel to PDF',category:'Convert to PDF',icon:'📈',description:'Convert every sheet of an .xlsx/.xls/.csv file into PDF pages.',accept:'.xlsx,.xls,.csv',multiple:false,options:[],
            run:async(files,o,ctx)=>{if(!window.XLSX)throw new Error('SheetJS failed to load.');const wb=XLSX.read(await files[0].arrayBuffer(),{type:'array'});
                const html=wb.SheetNames.map(n=>`<h2>${escapeHtml(n)}</h2>`+XLSX.utils.sheet_to_html(wb.Sheets[n],{header:'',footer:''}).replace(/^[\s\S]*?<body>|<\/body>[\s\S]*$/g,'')).join('');
                return pdfFrom(sanitizeHtml(html),baseName(files[0])+'.pdf',ctx);}});
        ovTool('img-to-pdf',{options:[{id:'orientation',label:'Page Orientation',type:'select',values:['Auto','Portrait','Landscape'],default:'Auto'},{id:'pageSize',label:'Page Size',type:'select',values:['A4','Letter','Fit to image'],default:'A4'},{id:'margin',label:'Margin',type:'select',values:['None','Small','Big'],default:'Small'}]});
        ovTool('ocr',{description:'OCR scanned PDFs/images with Tesseract.js (English, Urdu, Arabic).',options:[{id:'lang',label:'Language',type:'select',values:['English','Urdu','Arabic'],default:'English'},{id:'maxPages',label:'Max pages',type:'number',default:20}],
            run:async(files,o,ctx)=>{
                const L={English:'eng',Urdu:'urd',Arabic:'ara'}[o.lang]||'eng';ctx.updateProgress(5,'Loading OCR engine (first run downloads language data)...');
                const worker=await Tesseract.createWorker(L);let out='';
                try{
                    if(files[0].type==='application/pdf'){
                        const pdf=await pdfjsLib.getDocument({data:await files[0].arrayBuffer()}).promise;const n=Math.min(pdf.numPages,Math.max(1,parseInt(o.maxPages)||20));
                        for(let i=1;i<=n;i++){ctx.updateProgress(10+85*(i-1)/n,`OCR page ${i}/${n}...`);const c=await renderPageCanvas(pdf,i,2);const{data:{text}}=await worker.recognize(c);out+=`--- OCR Page ${i} ---\n${text}\n\n`;}
                        if(pdf.numPages>n)out+=`(Stopped at ${n} of ${pdf.numPages} pages - raise "Max pages" for more.)`;pdf.destroy();
                    }else{ctx.updateProgress(30,'Recognizing text...');out=(await worker.recognize(files[0])).data.text;}
                }finally{await worker.terminate();}
                return aiFile(out,'ocr_extracted_text.txt');}});
        // ===== PATCH 3: remaining tools =====
        const hexRgb=h=>{h=(h||'#000000').replace('#','');return PDFLib.rgb(parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255);};
        function drawPadHtml(id){return `<div><canvas id="pad_${id}" width="420" height="140" class="w-full rounded-xl border border-slate-300 bg-white touch-none"></canvas><button type="button" onclick="clearPad('${id}')" class="text-xs text-slate-500 mt-1">Clear</button></div>`;}
        function initDrawPads(opts){document.querySelectorAll('canvas[id^=pad_]').forEach(c=>{const id=c.id.slice(4),x=c.getContext('2d');x.lineWidth=3;x.lineCap='round';x.strokeStyle='#111';if(opts[id]){const i=new Image();i.onload=()=>x.drawImage(i,0,0);i.src=opts[id];}let d=false;const pt=e=>{const r=c.getBoundingClientRect();return[(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height];};c.onpointerdown=e=>{d=true;c.setPointerCapture(e.pointerId);const[a,b]=pt(e);x.beginPath();x.moveTo(a,b);};c.onpointermove=e=>{if(!d)return;const[a,b]=pt(e);x.lineTo(a,b);x.stroke();};c.onpointerup=()=>{d=false;setOpt(id,c.toDataURL('image/png'));};});}
        function clearPad(id){const c=document.getElementById('pad_'+id);c.getContext('2d').clearRect(0,0,c.width,c.height);setOpt(id,'');}
        async function pdfLines(page){const tc=await page.getTextContent();const rows=[];tc.items.forEach(it=>{if(!it.str.trim())return;const y=Math.round(it.transform[5]);let r=rows.find(r=>Math.abs(r.y-y)<3);if(!r){r={y,items:[]};rows.push(r);}r.items.push({x:it.transform[4],w:it.width,s:it.str});});rows.sort((a,b)=>b.y-a.y);rows.forEach(r=>r.items.sort((a,b)=>a.x-b.x));return rows;}
        const xmlEsc=s=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
        async function redactCore(file,terms,ctx){
            terms=terms.map(t=>String(t).trim().toLowerCase()).filter(t=>t.length>1);if(!terms.length)throw new Error('Enter at least one word or phrase to redact.');
            const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;const src=await loadPdf(file);const out=await PDFLib.PDFDocument.create();let hits=0;
            for(let p=1;p<=pdf.numPages;p++){
                ctx.updateProgress(p/pdf.numPages*95,`Redacting page ${p}/${pdf.numPages}...`);
                const page=await pdf.getPage(p),vp=page.getViewport({scale:2}),tc=await page.getTextContent(),rects=[];
                tc.items.forEach(it=>{const ls=it.str.toLowerCase();if(!ls)return;terms.forEach(t=>{let i=ls.indexOf(t);while(i>=0){const w=it.width,n=ls.length,x1=it.transform[4]+w*i/n,x2=it.transform[4]+w*(i+t.length)/n;
                    rects.push(vp.convertToViewportRectangle([x1,it.transform[5]-it.height*.25,x2,it.transform[5]+it.height*.9]));i=ls.indexOf(t,i+t.length);}});});
                if(rects.length){const c=await renderPageCanvas(pdf,p,2),x=c.getContext('2d');x.fillStyle='#000';
                    rects.forEach(r=>x.fillRect(Math.min(r[0],r[2])-2,Math.min(r[1],r[3])-2,Math.abs(r[2]-r[0])+4,Math.abs(r[3]-r[1])+4));
                    const img=await out.embedJpg(c.toDataURL('image/jpeg',.9)),b=page.getViewport({scale:1});out.addPage([b.width,b.height]).drawImage(img,{x:0,y:0,width:b.width,height:b.height});hits+=rects.length;}
                else{const[cp]=await out.copyPages(src,[p-1]);out.addPage(cp);}
            }
            pdf.destroy();if(!hits)throw new Error('No matching text found. For scanned PDFs run OCR first.');
            showToast(`Redacted ${hits} item(s). Affected pages were flattened to images so the text is truly removed.`,'success');return pdfOut(await out.save(),'redacted_document.pdf');
        }
        const ADD=[
        {id:'redact',name:'Redact PDF',category:'Edit & Security',icon:'⬛',description:'Permanently black out words/phrases. Affected pages become images so hidden text cannot be copied.',accept:'.pdf',multiple:false,
            options:[{id:'terms',label:'Words/phrases to redact (comma separated)',type:'text',default:''}],run:async(f,o,c)=>redactCore(f[0],o.terms.split(','),c)},
        {id:'ai-redact-smart',name:'AI Smart Redaction',category:'AI Features',icon:'🕵️',description:'Gemini finds personal data (names, emails, phones, IDs) and redacts it automatically.',accept:'.pdf',multiple:false,
            options:[{id:'types',label:'What to detect',type:'text',default:'names, email addresses, phone numbers, ID/passport numbers, street addresses, bank/card numbers'}],
            run:async(f,o,c)=>{checkGeminiApiKey();c.updateProgress(10,'Reading text...');const t=await extractTextFromPdf(f[0]);if(!t.trim())throw new Error('No selectable text found. Run OCR first.');
                c.updateProgress(30,'AI is finding sensitive data...');const r=await callGeminiApi(`Find all sensitive data of these types: ${o.types}. Return ONLY a JSON array of the exact strings as they appear in the text. No commentary.\n\n${t.slice(0,12000)}`);
                let a;try{a=JSON.parse(r.replace(/```json|```/g,'').trim());}catch(e){throw new Error('AI returned an unreadable list. Please try again.');}
                a=[...new Set(a.filter(x=>typeof x==='string'))];if(!a.length)throw new Error('No sensitive data detected.');const res=await redactCore(f[0],a,c);res.aiText='Redacted:\n'+a.join('\n');return res;}},
        {id:'sign',name:'Sign PDF',category:'Edit & Security',icon:'✍️',description:'Add a signature: draw it, type it, or upload an image (select the PDF first, then the image).',accept:'.pdf,image/png,image/jpeg',multiple:true,
            options:[{id:'mode',label:'Signature type',type:'select',values:['Draw','Type','Upload'],default:'Draw'},{id:'sig',label:'Draw here (for Draw)',type:'draw',default:''},{id:'text',label:'Typed name (for Type)',type:'text',default:''},
                {id:'pages',label:'Pages',type:'select',values:['Last page','First page','All pages'],default:'Last page'},{id:'pos',label:'Position',type:'select',values:['Bottom Right','Bottom Left','Bottom Center'],default:'Bottom Right'},{id:'width',label:'Width (pt)',type:'number',default:150}],
            run:async(f,o)=>{const pdfF=f.find(x=>/pdf$/i.test(x.type)||/\.pdf$/i.test(x.name));if(!pdfF)throw new Error('Select a PDF file.');let url;
                if(o.mode==='Draw'){if(!o.sig)throw new Error('Draw your signature first.');url=o.sig;}
                else if(o.mode==='Type'){if(!o.text.trim())throw new Error('Type your name.');await document.fonts.load('64px "Dancing Script"');const c=document.createElement('canvas');c.width=700;c.height=180;const x=c.getContext('2d');x.font='72px "Dancing Script", cursive';x.fillStyle='#111';x.textBaseline='middle';x.fillText(o.text.slice(0,30),20,90);url=c.toDataURL('image/png');}
                else{const im=f.find(x=>x.type.startsWith('image/'));if(!im)throw new Error('Also select a signature image (PNG/JPG).');const i=await loadImage(await readFileAsDataURL(im));const c=document.createElement('canvas');c.width=i.width;c.height=i.height;c.getContext('2d').drawImage(i,0,0);url=c.toDataURL('image/png');}
                const doc=await loadPdf(pdfF),img=await doc.embedPng(url),w=Math.max(30,parseFloat(o.width)||150),h=w*img.height/img.width,all=doc.getPages();
                const tg=o.pages==='All pages'?all:o.pages==='First page'?[all[0]]:[all[all.length-1]];
                tg.forEach(p=>{const{width:W}=p.getSize();const x=o.pos==='Bottom Left'?36:o.pos==='Bottom Center'?(W-w)/2:W-w-36;p.drawImage(img,{x,y:36,width:w,height:h});});
                return pdfOut(await doc.save(),'signed_document.pdf');}},
        {id:'edit-text',name:'Edit PDF',category:'Edit & Security',icon:'✏️',description:'Add text, rectangles or highlights at a position on any page (positions are % of the page).',accept:'.pdf',multiple:false,
            options:[{id:'action',label:'Action',type:'select',values:['Add Text','Add Rectangle','Highlight'],default:'Add Text'},{id:'page',label:'Page number',type:'number',default:1},{id:'x',label:'X from left (%)',type:'number',default:10},{id:'y',label:'Y from top (%)',type:'number',default:10},
                {id:'w',label:'Width (%) - shapes',type:'number',default:30},{id:'h',label:'Height (%) - shapes',type:'number',default:5},{id:'text',label:'Text',type:'text',default:'Hello'},{id:'size',label:'Font size',type:'number',default:14},{id:'color',label:'Color',type:'color',default:'#000000'}],
            run:async(f,o)=>{const doc=await loadPdf(f[0]),n=parseInt(o.page)||1;if(n<1||n>doc.getPageCount())throw new Error('Page number out of range.');const p=doc.getPage(n-1),{width:W,height:H}=p.getSize(),X=parseFloat(o.x)/100*W,col=hexRgb(o.color);
                if(o.action==='Add Text'){const font=await doc.embedFont(PDFLib.StandardFonts.Helvetica),sz=parseFloat(o.size)||14;try{font.widthOfTextAtSize(o.text,sz);}catch(e){throw new Error('Text has unsupported (non-Latin) characters.');}p.drawText(o.text,{x:X,y:H-parseFloat(o.y)/100*H-sz,size:sz,font,color:col});}
                else{const w=parseFloat(o.w)/100*W,h=parseFloat(o.h)/100*H;p.drawRectangle({x:X,y:H-parseFloat(o.y)/100*H-h,width:w,height:h,color:col,opacity:o.action==='Highlight'?.4:1});}
                return pdfOut(await doc.save(),'edited_document.pdf');}},
        {id:'extract-images',name:'Extract Images',category:'Convert from PDF',icon:'📸',description:'Pull out the embedded pictures from your PDF into a ZIP of PNG files.',accept:'.pdf',multiple:false,options:[],
            run:async(f,o,c)=>{const pdf=await pdfjsLib.getDocument({data:await f[0].arrayBuffer()}).promise,zip=new JSZip(),OPS=pdfjsLib.OPS;let n=0;
                for(let p=1;p<=pdf.numPages;p++){c.updateProgress(p/pdf.numPages*95,`Scanning page ${p}...`);const pg=await pdf.getPage(p),ops=await pg.getOperatorList(),seen=new Set();
                    for(let i=0;i<ops.fnArray.length;i++){if(ops.fnArray[i]!==OPS.paintImageXObject&&ops.fnArray[i]!==OPS.paintJpegXObject)continue;const nm=ops.argsArray[i][0];if(seen.has(nm))continue;seen.add(nm);
                        const ob=await new Promise(r=>{try{pg.objs.get(nm,r);}catch(e){r(null);}});if(!ob||!ob.width||ob.width<40||ob.height<40)continue;
                        const cv=document.createElement('canvas');cv.width=ob.width;cv.height=ob.height;const x=cv.getContext('2d');
                        if(ob.bitmap)x.drawImage(ob.bitmap,0,0);else if(ob.data){const im=x.createImageData(ob.width,ob.height),d=ob.data,q=im.data;
                            if(d.length===q.length)q.set(d);else if(d.length===ob.width*ob.height*3){for(let k=0,j=0;k<d.length;k+=3,j+=4){q[j]=d[k];q[j+1]=d[k+1];q[j+2]=d[k+2];q[j+3]=255;}}
                            else{const rb=Math.ceil(ob.width/8);for(let yy=0;yy<ob.height;yy++)for(let xx=0;xx<ob.width;xx++){const v=(d[yy*rb+(xx>>3)]>>(7-(xx&7)))&1?255:0,j=(yy*ob.width+xx)*4;q[j]=q[j+1]=q[j+2]=v;q[j+3]=255;}}x.putImageData(im,0,0);}else continue;
                        zip.file(`page${p}_image${++n}.png`,cv.toDataURL('image/png').split(',')[1],{base64:true});}}
                pdf.destroy();if(!n)throw new Error('No embedded images found in this PDF.');return new File([await zip.generateAsync({type:'blob'})],baseName(f[0])+'_images.zip',{type:'application/zip'});}},
        {id:'pdf-to-word',name:'PDF to Word',category:'Convert from PDF',icon:'📄',description:'Convert the text of a PDF into an editable .docx (text-based PDFs; run OCR first for scans).',accept:'.pdf',multiple:false,options:[],
            run:async(f,o,c)=>{const pdf=await pdfjsLib.getDocument({data:await f[0].arrayBuffer()}).promise;let body='',any=false;
                for(let p=1;p<=pdf.numPages;p++){c.updateProgress(p/pdf.numPages*90,`Page ${p}/${pdf.numPages}...`);const rows=await pdfLines(await pdf.getPage(p));
                    rows.forEach(r=>{const t=r.items.map(i=>i.s).join(' ').replace(/\s+/g,' ').trim();if(t){any=true;body+=`<w:p><w:r><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`;}});
                    if(p<pdf.numPages)body+='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';}
                pdf.destroy();if(!any)throw new Error('No selectable text found. Run OCR first.');
                const z=new JSZip();z.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
                z.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
                z.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
                return new File([await z.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})],baseName(f[0])+'.docx');}},
        {id:'pdf-to-excel',name:'PDF to Excel',category:'Convert from PDF',icon:'📊',description:'Detect tables by text alignment and export one sheet per page to .xlsx (text-based PDFs).',accept:'.pdf',multiple:false,options:[],
            run:async(f,o,c)=>{if(!window.XLSX)throw new Error('SheetJS failed to load.');const pdf=await pdfjsLib.getDocument({data:await f[0].arrayBuffer()}).promise,wb=XLSX.utils.book_new();
                for(let p=1;p<=pdf.numPages;p++){c.updateProgress(p/pdf.numPages*90,`Page ${p}/${pdf.numPages}...`);const rows=await pdfLines(await pdf.getPage(p)),cells=rows.map(r=>{const cs=[];r.items.forEach((it,i)=>{const pr=r.items[i-1];if(pr&&it.x-(pr.x+pr.w)<=10)cs[cs.length-1].s+=' '+it.s;else cs.push({x:it.x,s:it.s});});return cs;});
                    let tab=cells.filter(r=>r.length>=2);if(!tab.length)tab=cells;if(!tab.length)continue;const cols=[];tab.forEach(r=>r.forEach(k=>{if(!cols.some(x=>Math.abs(x-k.x)<12))cols.push(k.x);}));cols.sort((a,b)=>a-b);
                    const aoa=tab.map(r=>{const row=new Array(cols.length).fill('');r.forEach(k=>{let b=0;cols.forEach((x,i)=>{if(Math.abs(x-k.x)<Math.abs(cols[b]-k.x))b=i;});row[b]=row[b]?row[b]+' '+k.s:k.s;});return row;});
                    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'Page '+p);}
                pdf.destroy();if(!wb.SheetNames.length)throw new Error('No selectable text/tables found. Run OCR first.');
                return new File([XLSX.write(wb,{type:'array',bookType:'xlsx'})],baseName(f[0])+'.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});}},
        {id:'pdf-to-ppt',name:'PDF to PowerPoint',category:'Convert from PDF',icon:'📽️',description:'Turn each PDF page into a slide (image-based, not editable text).',accept:'.pdf',multiple:false,options:[],
            run:async(f,o,c)=>{if(!window.PptxGenJS)throw new Error('PptxGenJS failed to load.');const pdf=await pdfjsLib.getDocument({data:await f[0].arrayBuffer()}).promise,pr=new PptxGenJS(),v=(await pdf.getPage(1)).getViewport({scale:1});
                pr.defineLayout({name:'PDF',width:v.width/72,height:v.height/72});pr.layout='PDF';
                for(let i=1;i<=pdf.numPages;i++){c.updateProgress(i/pdf.numPages*95,`Slide ${i}/${pdf.numPages}...`);const cv=await renderPageCanvas(pdf,i,2);pr.addSlide().addImage({data:cv.toDataURL('image/jpeg',.85),x:0,y:0,w:'100%',h:'100%'});}
                pdf.destroy();return new File([await pr.write('blob')],baseName(f[0])+'.pptx');}},
        {id:'ppt-to-pdf',name:'PowerPoint to PDF',category:'Convert to PDF',icon:'📊',description:'Convert .pptx slides to PDF (slide text only; images and shapes are not included).',accept:'.pptx',multiple:false,options:[],
            run:async(f,o,c)=>{const z=await JSZip.loadAsync(await f[0].arrayBuffer()),nm=Object.keys(z.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>parseInt(a.match(/\d+/)[0])-parseInt(b.match(/\d+/)[0]));
                if(!nm.length)throw new Error('No slides found. Only .pptx files are supported.');let h='<div style="margin:-40px">';
                for(let i=0;i<nm.length;i++){const xml=await z.file(nm[i]).async('string'),ps=[...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map(m=>[...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(t=>t[1]).join('')).filter(Boolean);
                    h+=`<section style="box-sizing:border-box;height:1123px;padding:70px 60px;overflow:hidden"><div style="font-size:12px;color:#888">Slide ${i+1}</div>${ps.map((p,j)=>j?`<p>${p}</p>`:`<h1>${p}</h1>`).join('')}</section>`;}
                return pdfFrom(sanitizeHtml(h+'</div>'),baseName(f[0])+'.pdf',c);}},
        {id:'ai-ask-multi',name:'Ask Across PDFs',category:'AI Features',icon:'🗂️',description:'Index several PDFs and ask questions across all of them, with file and page citations.',accept:'.pdf',multiple:true,isInteractiveAi:true,options:[],
            run:async(f,o,c)=>{checkGeminiApiKey();let all=[];for(let i=0;i<f.length;i++){c.updateProgress(i/f.length*90,`Indexing ${f[i].name}...`);(await extractTextPagesFromPdf(f[i])).forEach(p=>all.push({...p,file:f[i].name}));}return{pagesText:all,fileName:f.length+' documents'};}}
        ];
        ADD.forEach(upsertTool);
        TOOLS.splice(0,TOOLS.length,...TOOLS.filter(t=>!t.isStub)); // no "coming soon" tools left

        function showToast(message, type = 'info') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = `p-4 rounded-xl border shadow-lg text-sm flex items-center justify-between gap-3 pointer-events-auto transition-all transform translate-y-2 opacity-0 ${
                type === 'error' ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300' :
                type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' :
                'bg-slate-900 dark:bg-slate-800 border-slate-700 text-white'
            }`;
            toast.innerHTML = `<span>${message}</span><button onclick="this.parentElement.remove()" class="text-xs opacity-60 hover:opacity-100">✕</button>`;
            container.appendChild(toast);
            
            setTimeout(() => {
                toast.classList.remove('translate-y-2', 'opacity-0');
            }, 10);

            setTimeout(() => {
                toast.classList.add('opacity-0', 'translate-y-2');
                setTimeout(() => toast.remove(), 200);
            }, 4000);
        }

        function parsePageRanges(rangeStr, totalPages) {
            const result = new Set();
            if (!rangeStr) return [];
            const parts = rangeStr.split(',');
            for (let part of parts) {
                part = part.trim();
                if (part.includes('-')) {
                    const [start, end] = part.split('-').map(n => parseInt(n.trim()));
                    if (!isNaN(start) && !isNaN(end)) {
                        for (let i = Math.max(1, start); i <= Math.min(totalPages, end); i++) {
                            result.add(i - 1);
                        }
                    }
                } else {
                    const val = parseInt(part);
                    if (!isNaN(val) && val >= 1 && val <= totalPages) {
                        result.add(val - 1);
                    }
                }
            }
            return Array.from(result).sort((a, b) => a - b);
        }

        function readFileAsDataURL(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        function loadImage(url) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = url;
            });
        }

        async function extractTextFromPdf(file) {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let fullText = '';
            for (let i = 1; i <= pdfDoc.numPages; i++) {
                const page = await pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                fullText += textContent.items.map(item => item.str).join(' ') + '\n';
            }
            return fullText;
        }

        async function extractTextPagesFromPdf(file) {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const pages = [];
            for (let i = 1; i <= pdfDoc.numPages; i++) {
                const page = await pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const text = textContent.items.map(item => item.str).join(' ');
                pages.push({ pageNum: i, text });
            }
            return pages;
        }

        function checkGeminiApiKey() { /* key lives on the server (api/gemini.js) */ }

        async function callGeminiApi(prompt) {
            const res = await fetch('/api/gemini', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'AI service is unavailable right now. Please try again.');
            return d.text || 'No response generated.';
        }

        function toggleTheme() {
            STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('pdfnest_theme', STATE.theme);
            applyTheme();
        }

        function applyTheme() {
            const isDark = STATE.theme === 'dark';
            document.documentElement.classList.toggle('dark', isDark);
            document.getElementById('themeIconSun').classList.toggle('hidden', !isDark);
            document.getElementById('themeIconMoon').classList.toggle('hidden', isDark);
        }

        function toggleFavorite(toolId, event) {
            if (event) event.stopPropagation();
            const idx = STATE.favorites.indexOf(toolId);
            if (idx >= 0) STATE.favorites.splice(idx, 1);
            else STATE.favorites.push(toolId);
            
            localStorage.setItem('pdfnest_favorites', JSON.stringify(STATE.favorites));
            renderSidebar();
            if (STATE.currentRoute === '#/') renderHome();
        }

        function recordRecentTool(toolId) {
            STATE.recents = [toolId, ...STATE.recents.filter(id => id !== toolId)].slice(0, 5);
            localStorage.setItem('pdfnest_recents', JSON.stringify(STATE.recents));
            renderSidebar();
        }

        function toggleCommandPalette(show) {
            const palette = document.getElementById('commandPalette');
            if (show) {
                palette.classList.remove('hidden');
                palette.classList.add('flex');
                document.getElementById('cmdInput').value = '';
                filterCommandPalette('');
                document.getElementById('cmdInput').focus();
            } else {
                palette.classList.add('hidden');
                palette.classList.remove('flex');
            }
        }

        function filterCommandPalette(q) {
            const list = document.getElementById('cmdList');
            const query = q.toLowerCase().trim();
            const filtered = TOOLS.filter(t => !t.isStub && (t.name.toLowerCase().includes(query) || t.category.toLowerCase().includes(query)));

            list.innerHTML = filtered.map(t => `
                <a href="${toolPath(t.id)}" onclick="toggleCommandPalette(false)" class="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors group">
                    <div class="flex items-center gap-3">
                        <span class="text-xl">${t.icon}</span>
                        <div>
                            <div class="text-sm font-semibold text-slate-800 dark:text-slate-200 group-hover:text-brand-600 dark:group-hover:text-brand-400">${t.name}</div>
                            <div class="text-xs text-slate-400">${t.category}</div>
                        </div>
                    </div>
                    ${t.isStub ? '<span class="text-[10px] px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Soon</span>' : ''}
                </a>
            `).join('') || '<div class="p-4 text-center text-xs text-slate-400">No tools found matching your search.</div>';
        }

        // Global Keyboard Listeners
        window.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                toggleCommandPalette(true);
            }
            if (e.key === 'Escape') {
                toggleCommandPalette(false);
            }
        });

        function renderSidebar() {
            const categoryNav = document.getElementById('categoryNav');
            categoryNav.innerHTML = CATEGORIES.map(cat => {
                const active = STATE.currentCategory === cat.id && STATE.currentRoute === '#/';
                return `
                    <button onclick="selectCategory('${cat.id}')" class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        active ? 'bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-400 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }">
                        <div class="flex items-center gap-2.5">
                            <span>${cat.icon}</span>
                            <span>${cat.name}</span>
                        </div>
                    </button>
                `;
            }).join('');

            const favoritesList = document.getElementById('favoritesList');
            const favTools = TOOLS.filter(t => STATE.favorites.includes(t.id) && !t.isStub);
            if (favTools.length === 0) {
                favoritesList.innerHTML = '<span class="text-xs italic text-slate-400">No favorite tools pinned yet.</span>';
            } else {
                favoritesList.innerHTML = favTools.map(t => `
                    <a href="${toolPath(t.id)}" class="flex items-center gap-2 py-1 hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
                        <span>${t.icon}</span>
                        <span class="truncate">${t.name}</span>
                    </a>
                `).join('');
            }
        }

        function selectCategory(catId) {
            STATE.currentCategory = catId;
            if (STATE.currentRoute !== '#/') {
                navigate('/');
            } else {
                renderHome();
            }
            renderSidebar();
        }

        function renderHome() {
            const main = document.getElementById('mainContent');
            
            // Filter tools
            const filteredTools = TOOLS.filter(tool => {
                const matchesCat = STATE.currentCategory === 'All' || tool.category === STATE.currentCategory;
                const matchesSearch = tool.name.toLowerCase().includes(STATE.searchQuery.toLowerCase()) || 
                                      tool.description.toLowerCase().includes(STATE.searchQuery.toLowerCase());
                return matchesCat && matchesSearch;
            });

            main.innerHTML = `
                <div class="max-w-6xl mx-auto space-y-8 pb-12">
                    <!-- Hero Banner -->
                    <div class="text-center space-y-3 pt-4">
                        <h1 class="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            Every PDF tool you need, <span class="bg-gradient-to-r from-brand-600 to-indigo-500 bg-clip-text text-transparent">100% Client-Side</span>
                        </h1>
                        <p class="text-base text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
                            Fast, private, and secure. Your files never leave your browser. Powered by AI and WebAssembly.
                        </p>
                    </div>

                    <!-- Search & Filter Bar -->
                    <div class="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                        <div class="relative w-full sm:w-80">
                            <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                            <input type="text" value="${escapeHtml(STATE.searchQuery)}" oninput="STATE.searchQuery = this.value; renderHome(); const si = document.querySelector('#mainContent input[type=text]'); si.focus(); si.setSelectionRange(si.value.length, si.value.length);" placeholder="Filter tools..." class="w-full pl-9 pr-4 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 focus:ring-2 focus:ring-brand-500 focus:outline-none">
                        </div>

                        <!-- Category Filter Pills for Mobile -->
                        <div class="flex lg:hidden overflow-x-auto w-full gap-2 pb-1 scrollbar-none">
                            ${CATEGORIES.map(c => `
                                <button onclick="selectCategory('${c.id}')" class="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                                    STATE.currentCategory === c.id ? 'bg-brand-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                }">${c.icon} ${c.name}</button>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Tools Grid -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        ${filteredTools.map(tool => {
                            const isFav = STATE.favorites.includes(tool.id);
                            return `
                                <div onclick="${tool.isStub ? `showToast('This tool is scheduled for release soon!', 'info')` : `navigate(toolPath('${tool.id}'))`}" 
                                     class="group relative bg-white dark:bg-slate-800/80 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 shadow-sm hover:shadow-md hover:border-brand-500/50 dark:hover:border-brand-500/50 transition-all cursor-pointer flex flex-col justify-between">
                                    
                                    <div>
                                        <div class="flex items-center justify-between mb-3">
                                            <div class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                                                ${tool.icon}
                                            </div>
                                            <div class="flex items-center gap-1.5">
                                                ${tool.isStub ? '<span class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800">Coming Soon</span>' : ''}
                                                <button onclick="toggleFavorite('${tool.id}', event)" class="p-1 text-slate-300 hover:text-amber-400 dark:text-slate-600 dark:hover:text-amber-400 transition-colors">
                                                    <svg class="w-5 h-5 ${isFav ? 'fill-amber-400 text-amber-400' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
                                                </button>
                                            </div>
                                        </div>
                                        <h3 class="font-bold text-base text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors mb-1">${tool.name}</h3>
                                        <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">${tool.description}</p>
                                    </div>

                                    <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
                                        <span>${tool.category}</span>
                                        <span class="font-semibold text-brand-600 dark:text-brand-400 opacity-0 group-hover:opacity-100 transition-opacity">Open Tool &rarr;</span>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        async function renderToolPage(toolId) {
            const tool = TOOLS.find(t => t.id === toolId);
            if (!tool) {
                navigate('/');
                return;
            }

            recordRecentTool(tool.id);
            const main = document.getElementById('mainContent');

            // Interactive state for current tool page instance
            const ctx = {
                files: [],
                pageThumbnails: [],
                selectedPages: [],
                pageOrder: [],
                resultFile: null,
                isProcessing: false,
                opts: {}
            };
            const chained = STATE.chainedFiles; STATE.chainedFiles = null;

            function updateUI() {
                main.innerHTML = `
                    <div class="max-w-4xl mx-auto space-y-6 pb-12">
                        <!-- Navigation Back Button -->
                        <div class="flex items-center justify-between">
                            <a href="/" class="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
                                Back to All Tools
                            </a>
                            <span class="text-xs text-slate-400 font-medium px-2.5 py-1 rounded-full bg-slate-200/60 dark:bg-slate-800">${tool.category}</span>
                        </div>

                        <!-- Tool Header -->
                        <div class="flex items-center gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                            <div class="w-14 h-14 rounded-2xl bg-brand-50 dark:bg-brand-950 flex items-center justify-center text-3xl shrink-0">
                                ${tool.icon}
                            </div>
                            <div>
                                <h1 class="text-2xl font-bold text-slate-900 dark:text-white">${tool.name}</h1>
                                <p class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">${tool.description}</p>
                            </div>
                        </div>

                        <!-- Dropzone Area -->
                        <div id="dropZone" ondragover="event.preventDefault(); this.classList.add('drag-over');" 
                             ondragleave="this.classList.remove('drag-over');" 
                             ondrop="handleDrop(event)" onclick="document.getElementById('fileInput').click()"
                             class="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-brand-500 dark:hover:border-brand-500 bg-white/50 dark:bg-slate-800/40 rounded-2xl p-8 text-center transition-all cursor-pointer">
                            
                            <input type="file" id="fileInput" ${tool.multiple ? 'multiple' : ''} accept="${tool.accept}" onchange="handleFileSelect(event)" onclick="event.stopPropagation()" class="hidden">
                            
                            <div class="flex flex-col items-center gap-3">
                                <div class="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-950/80 text-brand-600 dark:text-brand-400 flex items-center justify-center text-xl">
                                    ☁️
                                </div>
                                <div>
                                    <p class="text-base font-semibold text-slate-800 dark:text-slate-200">
                                        Drag & drop your file${tool.multiple ? 's' : ''} here, or <span class="text-brand-600 dark:text-brand-400 hover:underline">browse</span>
                                    </p>
                                    <p class="text-xs text-slate-400 mt-1">Accepted formats: ${tool.accept}</p>
                                </div>
                            </div>
                        </div>

                        <!-- Selected Files & Visual Page Grid -->
                        ${ctx.files.length > 0 ? `
                            <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
                                <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                                    <h3 class="font-bold text-slate-900 dark:text-white text-sm">Selected Document${ctx.files.length > 1 ? 's' : ''} (${ctx.files.length})</h3>
                                    <button onclick="clearFiles()" class="text-xs text-red-500 hover:underline">Clear all</button>
                                </div>

                                <div class="space-y-2">
                                    ${ctx.files.map((f, idx) => `
                                        <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-700/50">
                                            <div class="flex items-center gap-3 truncate">
                                                <span class="text-lg">📄</span>
                                                <div class="truncate">
                                                    <div class="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">${escapeHtml(f.name)}</div>
                                                    <div class="text-xs text-slate-400">${fmtSize(f.size)}</div>
                                                </div>
                                            </div>
                                            <button onclick="removeFile(${idx})" class="p-1 text-slate-400 hover:text-red-500">✕</button>
                                        </div>
                                    `).join('')}
                                </div>

                                <!-- Visual Page Thumbnails Browser (for split/extract/remove/reorder) -->
                                ${ctx.pageThumbnails.length > 0 ? `
                                    <div class="pt-4 border-t border-slate-200 dark:border-slate-700">
                                        <div class="flex items-center justify-between mb-3">
                                            <h4 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Document Pages (${ctx.pageThumbnails.length})</h4>
                                            <span class="text-xs text-slate-500">${tool.hasVisualReorder ? 'Drag tiles to reorder' : 'Click pages to toggle selection'}</span>
                                        </div>
                                        <div id="pagesGrid" class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-96 overflow-y-auto p-1">
                                            ${ctx.pageOrder.map(idx => { const thumb = ctx.pageThumbnails[idx];
                                                const isSelected = ctx.selectedPages.includes(idx);
                                                return `
                                                    <div data-id="${idx}" onclick="togglePageSelection(${idx})" 
                                                         class="page-card relative border-2 rounded-xl p-2 bg-slate-50 dark:bg-slate-900/80 cursor-pointer flex flex-col items-center gap-2 ${
                                                            isSelected ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-slate-200 dark:border-slate-700 opacity-80'
                                                         }">
                                                        <img ${thumb ? `src="${thumb}"` : ''} data-pg="${idx}" class="h-28 w-20 object-contain rounded shadow-sm">
                                                        <span class="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Page ${idx + 1}</span>
                                                    </div>
                                                `;
                                            }).join('')}
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        ` : ''}

                        <!-- Tool Config Options Panel -->
                        ${tool.options && tool.options.length > 0 ? `
                            <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
                                <h3 class="font-bold text-slate-900 dark:text-white text-sm border-b border-slate-200 dark:border-slate-700 pb-2">Tool Options</h3>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    ${tool.options.map(opt => `
                                        <div class="space-y-1">
                                            <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300">${opt.label}</label>
                                            ${opt.type === 'draw' ? drawPadHtml(opt.id) : opt.type === 'select' ? `
                                                <select id="opt_${opt.id}" onchange="setOpt('${opt.id}', this.value)" class="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none">
                                                    ${opt.values.map(v => `<option value="${v}" ${v === (ctx.opts[opt.id] ?? opt.default) ? 'selected' : ''}>${v}</option>`).join('')}
                                                </select>
                                            ` : `
                                                <input type="${opt.type}" id="opt_${opt.id}" value="${escapeHtml(String(ctx.opts[opt.id] ?? opt.default))}" oninput="setOpt('${opt.id}', this.value)" class="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none">
                                            `}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}

                        <!-- Action Button & Progress Indicator -->
                        ${ctx.files.length > 0 ? `
                            <div class="space-y-3">
                                <button id="processBtn" onclick="executeTool()" ${ctx.isProcessing ? 'disabled' : ''} class="w-full py-3.5 px-6 rounded-xl font-bold text-white bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-700 hover:to-indigo-700 shadow-md shadow-brand-500/20 transition-all flex items-center justify-center gap-2 text-base">
                                    <span>${tool.icon}</span>
                                    <span>${tool.isInteractiveAi ? 'Index Document' : 'Process Document'}</span>
                                </button>

                                <div id="progressContainer" class="hidden space-y-2">
                                    <div class="flex justify-between text-xs text-slate-500 font-medium">
                                        <span id="progressStatus">Processing...</span>
                                        <span id="progressPercent">0%</span>
                                    </div>
                                    <div class="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                        <div id="progressBar" class="h-full bg-brand-600 transition-all duration-200" style="width: 0%"></div>
                                    </div>
                                </div>
                            </div>
                        ` : ''}

                        <!-- Interactive AI Chat Box UI (for Chat with PDF) -->
                        ${tool.isInteractiveAi && ctx.chatData ? `
                            <div class="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
                                <h3 class="font-bold text-slate-900 dark:text-white text-base">💬 Chat with ${escapeHtml(ctx.chatData.fileName)}</h3>
                                <div id="chatMessages" class="h-64 overflow-y-auto space-y-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-700">
                                    <div class="bg-brand-50 dark:bg-brand-950/80 text-brand-900 dark:text-brand-200 p-3 rounded-xl text-xs max-w-lg">
                                        Hello! I have indexed all pages of your PDF document. Ask me any question!
                                    </div>
                                </div>
                                <div class="flex gap-2">
                                    <input type="text" id="chatInput" placeholder="Ask a question about the document..." class="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none">
                                    <button onclick="sendChatMessage()" class="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm rounded-xl">Send</button>
                                </div>
                            </div>
                        ` : ''}

                        <!-- Output Result Card -->
                        ${ctx.resultFile ? `
                            <div class="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl p-6 space-y-4">
                                <div class="flex items-center gap-3 text-emerald-700 dark:text-emerald-400">
                                    <span class="text-2xl">🎉</span>
                                    <div>
                                        <h3 class="font-bold text-base">Processing Completed!</h3>
                                        <p class="text-xs opacity-90">${escapeHtml(ctx.resultFile.name)} (${fmtSize(ctx.resultFile.size)}${ctx.resultFile.origSize ? ' — before: ' + fmtSize(ctx.resultFile.origSize) : ''})</p>
                                    </div>
                                </div>

                                <!-- AI Text Preview if applicable -->
                                ${ctx.resultFile.aiText ? `
                                    <div class="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
                                        ${renderMd(ctx.resultFile.aiText)}
                                    </div>
                                ` : ''}

                                <div class="flex flex-wrap gap-3 pt-2 border-t border-emerald-200/60 dark:border-emerald-800/60">
                                    <button onclick="downloadResult()" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow flex items-center gap-2">
                                        <span>⬇️</span> Download File
                                    </button>

                                    <!-- Tool Chaining Menu -->
                                    <div class="relative">
                                        <button onclick="toggleChainingMenu()" class="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2">
                                            <span>⚡</span> Send to another tool &darr;
                                        </button>
                                        <div id="chainingMenu" class="hidden absolute left-0 mt-2 w-56 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl z-20 p-1 space-y-1">
                                            ${TOOLS.filter(t => !t.isStub && t.id !== tool.id && t.accept && fileMatchesAccept(ctx.resultFile, t.accept)).map(t => `
                                                <button onclick="chainToTool('${t.id}')" class="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                                    <span>${t.icon}</span>
                                                    <span>${t.name}</span>
                                                </button>
                                            `).join('')}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                `;

                if (ctx.pdfDoc && ctx.pageThumbnails.length) {
                    const io = new IntersectionObserver(async (entries) => {
                        for (const en of entries) {
                            if (!en.isIntersecting) continue;
                            const img = en.target; io.unobserve(img);
                            const idx = +img.dataset.pg;
                            if (ctx.pageThumbnails[idx]) { img.src = ctx.pageThumbnails[idx]; continue; }
                            try {
                                const pg = await ctx.pdfDoc.getPage(idx + 1);
                                const vp = pg.getViewport({ scale: 0.3 });
                                const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
                                await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
                                ctx.pageThumbnails[idx] = c.toDataURL('image/jpeg', 0.7); img.src = ctx.pageThumbnails[idx];
                            } catch (e) { /* doc closed */ }
                        }
                    }, { root: document.getElementById('pagesGrid'), rootMargin: '200px' });
                    document.querySelectorAll('#pagesGrid img[data-pg]').forEach(i => io.observe(i));
                }
                initDrawPads(ctx.opts);
                const ci = document.getElementById('chatInput');
                if (ci) ci.addEventListener('keydown', ev => { if (ev.key === 'Enter') sendChatMessage(); });

                // Initialize Sortable.js if visual page reordering tool
                if (tool.hasVisualReorder && ctx.pageThumbnails.length > 0) {
                    const grid = document.getElementById('pagesGrid');
                    if (grid) {
                        new Sortable(grid, {
                            animation: 150,
                            onEnd: (evt) => {
                                const newOrder = Array.from(grid.querySelectorAll('.page-card')).map(el => parseInt(el.dataset.id));
                                ctx.pageOrder = newOrder;
                            }
                        });
                    }
                }
            }

            // File handlers inside closure
            window.setOpt = (id, v) => { ctx.opts[id] = v; };
            window.handleFileSelect = async (e) => {
                const selected = Array.from(e.target.files);
                if (selected.length) await loadFiles(selected);
            };

            window.handleDrop = async (e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag-over');
                const all = Array.from(e.dataTransfer.files);
                const dropped = all.filter(f => !tool.accept || fileMatchesAccept(f, tool.accept));
                if (dropped.length < all.length) showToast(`Unsupported file type. Accepted: ${escapeHtml(tool.accept)}`, 'error');
                if (dropped.length) await loadFiles(dropped);
            };

            async function loadFiles(newFiles) {
                if (tool.multiple) {
                    ctx.files = [...ctx.files, ...newFiles];
                } else {
                    ctx.files = [newFiles[0]];
                }

                ctx.resultFile = null;
                ctx.pageThumbnails = [];
                ctx.selectedPages = [];
                ctx.pageOrder = [];
                if (ctx.pdfDoc) { ctx.pdfDoc.destroy(); ctx.pdfDoc = null; }

                // Render page thumbnails if single PDF
                if ((tool.hasVisualSelector || tool.hasVisualReorder) && ctx.files.length === 1 && ctx.files[0].type === 'application/pdf') {
                    try {
                        const bytes = await ctx.files[0].arrayBuffer();
                        const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
                        const thumbs = new Array(pdfDoc.numPages).fill(null);
                        ctx.pdfDoc = pdfDoc;
                        ctx.pageThumbnails = thumbs;
                        ctx.pageOrder = thumbs.map((_, i) => i);
                    } catch (e) {
                        showToast('Error generating PDF page thumbnails.', 'error');
                    }
                }

                updateUI();
            }

            window.removeFile = (index) => {
                if (ctx.pdfDoc) { ctx.pdfDoc.destroy(); ctx.pdfDoc = null; }
                ctx.files.splice(index, 1);
                ctx.pageThumbnails = [];
                ctx.resultFile = null;
                updateUI();
            };

            window.clearFiles = () => {
                if (ctx.pdfDoc) { ctx.pdfDoc.destroy(); ctx.pdfDoc = null; }
                ctx.files = [];
                ctx.pageThumbnails = [];
                ctx.resultFile = null;
                updateUI();
            };

            window.togglePageSelection = (idx) => {
                if (tool.hasVisualReorder) return;
                const pos = ctx.selectedPages.indexOf(idx);
                if (pos >= 0) ctx.selectedPages.splice(pos, 1);
                else ctx.selectedPages.push(idx);
                updateUI();
            };

            window.executeTool = async () => {
                if (!ctx.files.length || ctx.isProcessing) return;
                ctx.isProcessing = true;
                ctx.resultFile = null;

                const progressContainer = document.getElementById('progressContainer');
                const progressBar = document.getElementById('progressBar');
                const progressStatus = document.getElementById('progressStatus');
                const progressPercent = document.getElementById('progressPercent');

                progressContainer.classList.remove('hidden');

                const opts = {};
                if (tool.options) {
                    tool.options.forEach(opt => {
                        const el = document.getElementById(`opt_${opt.id}`);
                        if (el) opts[opt.id] = el.value;
                    });
                }

                if (tool.options) tool.options.forEach(o => { if (o.type === 'draw') opts[o.id] = ctx.opts[o.id]; });
                const executionCtx = {
                    updateProgress: (pct, msg) => {
                        progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
                        progressPercent.innerText = `${Math.round(pct)}%`;
                        if (msg) progressStatus.innerText = msg;
                    },
                    selectedPages: ctx.selectedPages,
                    pageOrder: ctx.pageOrder
                };

                try {
                    const result = await tool.run(ctx.files, opts, executionCtx);
                    if (tool.isInteractiveAi) {
                        ctx.chatData = result;
                    } else {
                        ctx.resultFile = result;
                    }
                    showToast('Task completed successfully!', 'success');
                } catch (err) {
                    showToast(escapeHtml(friendlyError(err)), 'error');
                } finally {
                    ctx.isProcessing = false;
                    progressContainer.classList.add('hidden');
                    updateUI();
                }
            };

            window.downloadResult = () => {
                if (ctx.resultFile) {
                    saveAs(ctx.resultFile, ctx.resultFile.name);
                }
            };

            window.toggleChainingMenu = () => {
                const menu = document.getElementById('chainingMenu');
                menu.classList.toggle('hidden');
            };

            window.chainToTool = (targetToolId) => {
                if (ctx.resultFile) {
                    STATE.chainedFiles = [ctx.resultFile];
                    navigate(toolPath(targetToolId));
                }
            };

            window.sendChatMessage = async () => {
                const input = document.getElementById('chatInput');
                const query = input.value.trim();
                if (!query || !ctx.chatData) return;
                const box = document.getElementById('chatMessages');
                box.insertAdjacentHTML('beforeend', `<div class="bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 p-3 rounded-xl text-xs max-w-lg ml-auto text-right">${escapeHtml(query)}</div>`);
                input.value = '';
                const think = document.createElement('div');
                think.className = 'text-xs italic text-slate-400 p-2'; think.textContent = 'thinking...';
                box.appendChild(think); box.scrollTop = box.scrollHeight;
                try {
                    const tok = t => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
                    const terms = new Set(tok(query).filter(w => w.length > 2 && !STOPWORDS.includes(w)));
                    const top = ctx.chatData.pagesText.map(p => ({ ...p, score: tok(p.text).filter(w => terms.has(w)).length }))
                        .sort((a, b) => b.score - a.score).slice(0, 3);
                    const context = top.map(p => `[${p.file ? p.file + ', ' : ''}Page ${p.pageNum}]\n${p.text.substring(0, 3000)}`).join('\n\n');
                    ctx.chatHistory = ctx.chatHistory || [];
                    const hist = ctx.chatHistory.slice(-6).map(m => `${m.role}: ${m.text}`).join('\n');
                    const response = await callGeminiApi(`Answer using only these excerpts and mention page numbers.\n\nExcerpts:\n${context}\n\nConversation:\n${hist}\n\nUser: ${query}`);
                    ctx.chatHistory.push({ role: 'User', text: query }, { role: 'Assistant', text: response });
                    think.remove();
                    const pages = top.map(p => (p.file ? p.file + ' p.' : 'p.') + p.pageNum).join(', ');
                    box.insertAdjacentHTML('beforeend', `<div class="bg-brand-50 dark:bg-brand-950/80 text-brand-900 dark:text-brand-200 p-3 rounded-xl text-xs max-w-lg space-y-1"><div class="whitespace-pre-wrap">${renderMd(response)}</div><div class="text-[10px] font-semibold opacity-70 border-t border-brand-200 dark:border-brand-800 pt-1 mt-1">📍 Pages used: ${pages} of ${escapeHtml(ctx.chatData.fileName)}</div></div>`);
                } catch (e) { think.remove(); showToast(escapeHtml(friendlyError(e)), 'error'); }
                box.scrollTop = box.scrollHeight;
            };

            // If chained files exist on initial load, auto start
            updateUI();
            if (chained && chained.length > 0) {
                await loadFiles(chained);
            }
        }

        function handleRouting() {
            // Old "#/tool/<id>" links -> real URLs
            const m = location.hash.match(/^#\/tool\/(.+)$/);
            if (m && SLUGS[m[1]]) history.replaceState({}, '', toolPath(m[1]));
            else if (location.hash === '#/' && location.pathname === '/') history.replaceState({}, '', '/');
            const toolId = SLUG_TO_ID[location.pathname.replace(/^\/|\/$/g, '')] || null;
            STATE.currentRoute = toolId ? '#/tool/' + toolId : '#/';
            syncSeo(toolId);
            if (toolId) renderToolPage(toolId); else renderHome();
            renderSidebar();
        }

        window.addEventListener('popstate', handleRouting);

        // App Initialization
        window.onload = () => {
            checkLibs();
            applyTheme();
            renderSidebar();
            handleRouting();
        };
    