// ────────────────────────────────────────────────────────────────
//  server.js  –  File processor + email sender + Compare & Clean
//               UPDATED: unified phone-column handling
// ────────────────────────────────────────────────────────────────
const express      = require('express');
const multer       = require('multer');
const XLSX         = require('xlsx');
const nodemailer   = require('nodemailer');
const cors         = require('cors');
const dotenv       = require('dotenv');

dotenv.config();          //  Loads .env
const app   = express();
const PORT  = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ────────────────────────────────────────────────────────────────
//  Multer (in-memory) – 50 MB / 10 files
// ────────────────────────────────────────────────────────────────
const upload = multer({
	storage: multer.memoryStorage(),
	limits : { fileSize: 50 * 1024 * 1024, files: 10 },
	fileFilter: (req, file, cb) => {
		const okMime = [
			'application/vnd.ms-excel',
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'text/csv',
		];
		if (okMime.includes(file.mimetype) || /\.(xlsx?|csv)$/i.test(file.originalname)) {
			return cb(null, true);
		}
		cb(new Error('Invalid file type. Only Excel and CSV files are allowed.'));
	},
});

// ────────────────────────────────────────────────────────────────
//  Mail transporter (Gmail SMTP) – throws if creds missing
// ────────────────────────────────────────────────────────────────
if (!process.env.EMAIL_USER || !(process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD)) {
	throw new Error('EMAIL_USER and EMAIL_PASS (or EMAIL_PASSWORD) must be set in .env');
}

const transporter = nodemailer.createTransport({
	host  : 'smtp.gmail.com',
	port  : 465,
	secure: true,
	auth  : {
		user: process.env.EMAIL_USER,
		pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD,
	},
});

// ────────────────────────────────────────────────────────────────
//  Helper utilities
// ────────────────────────────────────────────────────────────────
const getTodayDate = () => {
	const d = new Date();
	return `${String(d.getDate()).padStart(2, '0')}_${String(d.getMonth() + 1).padStart(2, '0')}_${d.getFullYear()}`;
};

const readFileAsWorkbook = (buffer, filename) => {
	try {
		return XLSX.read(buffer, { type: 'buffer', cellDates: true, cellStyles: true, cellNF: true });
	} catch (e) {
		console.error(`Error reading ${filename}:`, e);
		throw new Error(`Cannot read ${filename}`);
	}
};

const processRow = (row, cols) => {
	const copy = { ...row };
	cols.forEach((c) => delete copy[c]);
	return copy;
};

/*────────────────────────────────────────────────────────────────
  NEW:  Canonicalise phone column names in a row
────────────────────────────────────────────────────────────────*/
const normalisePhone = (row) => {
	const candidates = [
		'phone_number',
		'phone',
		'Phone',
		'Phone Number',
		'phone number',
		'Phone_Number',
		'PhoneNumber',
	];

	const key = candidates.find((k) => row[k] !== undefined && row[k] !== '');
	if (!key) return row; // nothing to do

	// strip prefixes like p:+ or p:
	const cleaned = String(row[key]).replace(/p:\+|p:/gi, '');

	// set canonical field
	row.phone_number = cleaned;

	// keep ONLY the canonical version
	if (key !== 'phone_number') delete row[key];
	return row;
};

// ────────────────────────────────────────────────────────────────
//  Extract date from filename & determine newer file
// ────────────────────────────────────────────────────────────────
const extractDateFromFilename = (filename) => {
	const m = filename.match(/(\d{2})_(\d{2})(?:_(\d{4}))?/);
	if (!m) return null;
	const [ , day, month, year ] = m;
	return new Date(parseInt(year || new Date().getFullYear(), 10),
	                parseInt(month, 10) - 1,
	                parseInt(day, 10));
};

const determineNewerFile = (file1, file2) => {
	const d1 = extractDateFromFilename(file1.originalname);
	const d2 = extractDateFromFilename(file2.originalname);
	if (!d1 || !d2) return file1; // fallback
	return d1 > d2 ? file1 : file2;
};

// ────────────────────────────────────────────────────────────────
//  Compare & Clean
// ────────────────────────────────────────────────────────────────
const compareAndClean = (files) => {
	if (files.length !== 2) throw new Error('Compare and Clean requires exactly 2 files');

	const [file1, file2] = files;
	const newerFile = determineNewerFile(file1, file2);
	const olderFile = newerFile === file1 ? file2 : file1;

	const newerWb = readFileAsWorkbook(newerFile.buffer, newerFile.originalname);
	const olderWb = readFileAsWorkbook(olderFile.buffer, olderFile.originalname);

	// collect emails from older file
	const olderEmails = new Set();
	olderWb.SheetNames.forEach((sh) => {
		XLSX.utils.sheet_to_json(olderWb.Sheets[sh], { defval: '' }).forEach((row) => {
			const email =
				row.email || row.Email || row.EMAIL ||
				row.email_address || row['Email Address'] ||
				row.mail || row.Mail;
			if (email && typeof email === 'string' && email.includes('@')) {
				olderEmails.add(email.toLowerCase().trim());
			}
		});
	});

	// clean newer file
	const cleanedData = [];
	let dupes = 0, total = 0;

	newerWb.SheetNames.forEach((sh) => {
		XLSX.utils.sheet_to_json(newerWb.Sheets[sh], { defval: '' }).forEach((row) => {
			total++;
			const email =
				row.email || row.Email || row.EMAIL ||
				row.email_address || row['Email Address'] ||
				row.mail || row.Mail;

			if (email && olderEmails.has(email.toLowerCase().trim())) {
				dupes++;
				return; // skip
			}
			cleanedData.push(row);
		});
	});

	const cleanedWb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(cleanedWb, XLSX.utils.json_to_sheet(cleanedData), 'Cleaned Data');

	const base   = newerFile.originalname.replace(/\.(xlsx?|csv)$/i, '');
	const ext    = newerFile.originalname.match(/\.(xlsx?|csv)$/i)?.[0] || '.xlsx';
	const outName = `${base}_clean${ext}`;

	return {
		filename          : outName,
		buffer            : XLSX.write(cleanedWb, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount          : cleanedData.length,
		duplicatesRemoved : dupes,
		totalOriginalRows : total,
		olderFileName     : olderFile.originalname,
		newerFileName     : newerFile.originalname,
	};
};

// ────────────────────────────────────────────────────────────────
//  ▼▼▼  THREE existing processing pipelines  ▼▼▼
//      (all now call normalisePhone  ⬇️)
// ────────────────────────────────────────────────────────────────
const processLacInfo = (workbooks) => {
	const out = [];
	workbooks.forEach((wb) => {
		wb.SheetNames.forEach((sheet) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).forEach((row) => {
				const colsToDelete = [
					'id','created_time','ad_id','ad_name','adset_id','adset_name',
					'campaign_id','campaign_name','form_id','platform','is_organic','lead_status',
				];
				const r = processRow(row, colsToDelete);

				r.Type = 'Piste';
				if (r.form_name !== undefined) {
					r.opportunité = r.form_name;
					delete r.form_name;
				}
				if (r.opportunité) {
					const v = String(r.opportunité).toLowerCase();
					if (v.includes('linfo') || v.includes('licence info') || v.includes('licence informatique') || v.includes('licence info 2025'))
						r.opportunité = 'Licence Informatique';
					else if (v.includes('lac') || v.includes('licence commerce') || v.includes('licence science commerciales') || v.includes('licence sciences commerciales année 25-26'))
						r.opportunité = 'Licence Science Commercial et marketing';
					else if (v.includes('lfc') || v.includes('licence finance'))
						r.opportunité = 'Licence Finance et Comptabilité';
				}

				normalisePhone(r);               // << unified phone handling
				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');
	return {
		filename: `ads_ifag_${getTodayDate()}.xlsx`,
		buffer  : XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount: out.length,
	};
};

const processInsagCneIf = (workbooks) => {
	const out = [];
	workbooks.forEach((wb) => {
		wb.SheetNames.forEach((sheet) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).forEach((row) => {
				const colsToDelete = [
					'id','created_time','ad_id','ad_name','adset_id','adset_name',
					'campaign_id','campaign_name','form_id','is_organic','platform',
				];
				const r = processRow(row, colsToDelete);

				if (r.form_name !== undefined) {
					r.opportunité = r.form_name;
					delete r.form_name;
				}
				if (r.opportunité && String(r.opportunité).includes('MBA Global CNE-copy'))
					r.opportunité = 'MBA Global CNE';

				r.bu = 'insfag_crm_sale.business_unit_diploma_courses';

				if (r.opportunité === 'MBA Global CNE') {
					r.company        = 'insfag_root.secondary_company';
					r['product cible'] = 'insfag_crm_sale.product_template_mba_mos';
				} else if (String(r.opportunité || '').includes('Exécutive MBA Finance')) {
					r.company        = 'base.main_company';
					r['product cible'] = 'insfag_crm_sale.product_template_emba_sfe';
				}

				normalisePhone(r);               // << unified phone handling
				r.source = '__export__.utm_source_11_b17eb5a0';
				r['Equipe commercial'] = '__export__.crm_team_6_3cd792db';
				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');
	return {
		filename: `ads_insag_${getTodayDate()}.xlsx`,
		buffer  : XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount: out.length,
	};
};

const processAwareness = (workbooks) => {
	const out = [];
	workbooks.forEach((wb) => {
		wb.SheetNames.forEach((sheet) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).forEach((row) => {
				const colsToDelete = [
					'id','created_time','ad_id','ad_name','adset_id','adset_name',
					'campaign_id','campaign_name','form_id','form_name','is_organic',
				];
				const r = processRow(row, colsToDelete);

				if (r.platform !== undefined) { r.Type = 'Piste'; delete r.platform; }

				const longCol = 'par_quelles_formation_êtes-vous_intéressé_?';
				if (r[longCol] !== undefined) { r.opportunité = r[longCol]; delete r[longCol]; }

				if (r.opportunité) {
					const v = String(r.opportunité).toLowerCase();
					if (v.includes('linfo') || v.includes('licence info') || v.includes('licence_informatique'))
						r.opportunité = 'Licence informatique';
					else if (v.includes('lac') || v.includes('licence commerce') || v.includes('licence_commerce_&_marketing'))
						r.opportunité = 'Licence Science Commercial et marketing';
					else if (v.includes('lfc') || v.includes('licence_finance_et_comptabilité'))
						r.opportunité = 'Licence Finance et Comptabilité';
					else if (v.includes('master mm') || v.includes('master_marketing_&_management'))
						r.opportunité = 'Master Marketing Management';
					else if (v.includes('master_en_transformation_digitale_et_e-business'))
						r.opportunité = 'Master Transformation digital et E-Business';
				}

				normalisePhone(r);               // << unified phone handling
				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');
	return {
		filename: `ads_awareness_ifag_${getTodayDate()}.xlsx`,
		buffer  : XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount: out.length,
	};
};

// ────────────────────────────────────────────────────────────────
//  Attachment helper
// ────────────────────────────────────────────────────────────────
const makeAttachment = ({ filename, buffer }) => ({
	filename,
	content     : buffer.toString('base64'),
	encoding    : 'base64',
	contentType : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

// ────────────────────────────────────────────────────────────────
//  POST /api/process
// ────────────────────────────────────────────────────────────────
app.post('/api/process', upload.array('files'), async (req, res) => {
	try {
		const files  = req.files;
		const opts   = JSON.parse(req.body.options || '{}');
		const email  = req.body.email;

		if (!files?.length) return res.status(400).json({ error: 'No files uploaded' });
		if (!/@/.test(email || '')) return res.status(400).json({ error: 'Valid email required' });

		const processed = [];
		const summary   = [];

		if (opts.compareAndClean) {                    // ---- Compare & Clean
			if (files.length !== 2)
				return res.status(400).json({ error: 'Compare and Clean requires exactly 2 files' });
			const r = compareAndClean(files);
			processed.push(r);
			summary.push(`Compare & Clean: ${r.duplicatesRemoved} duplicates removed from ${r.totalOriginalRows} rows (final ${r.rowCount} rows)`);
		} else {                                       // ---- Regular pipelines
			const wbs = files.map((f) => readFileAsWorkbook(f.buffer, f.originalname));

			if (opts.lacInfo)   { const r = processLacInfo(wbs);      processed.push(r); summary.push(`LAC Info: ${r.rowCount} rows`); }
			if (opts.insagCneIf){ const r = processInsagCneIf(wbs);   processed.push(r); summary.push(`Insag CNE IF: ${r.rowCount} rows`); }
			if (opts.awareness) { const r = processAwareness(wbs);    processed.push(r); summary.push(`Awareness: ${r.rowCount} rows`); }
		}

		if (!processed.length) return res.status(400).json({ error: 'No processing option selected' });

		await transporter.sendMail({
			from       : `File Processor <${process.env.EMAIL_USER}>`,
			to         : email,
			subject    : opts.compareAndClean ? 'Cleaned Excel file' : 'Processed Excel files',
			html       : `<p>Your files have been processed:</p><ul>${summary.map((s)=>`<li>${s}</li>`).join('')}</ul>`,
			attachments: processed.map(makeAttachment),
		});

		res.json({ success: true, filesProcessed: processed.length, details: summary });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
});

// ────────────────────────────────────────────────────────────────
//  Health & global error handling
// ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));
app.use((err, _req, res, _next) => {
	if (err instanceof multer.MulterError) {
		if (err.code === 'LIMIT_FILE_SIZE')  return res.status(400).json({ error: 'File too large (max 50 MB)' });
		if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files (max 10)' });
	}
	res.status(500).json({ error: err.message });
});

// ────────────────────────────────────────────────────────────────
//  Boot
// ────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
