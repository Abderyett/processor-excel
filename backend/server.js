// ────────────────────────────────────────────────────────────────
//  server.js  –  File processor + email sender
// ────────────────────────────────────────────────────────────────
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config(); //  Loads .env

// ────────────────────────────────────────────────────────────────
//  Express + middleware
// ────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ────────────────────────────────────────────────────────────────
//  Multer (in-memory) – 50 MB / 10 files
// ────────────────────────────────────────────────────────────────
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 50 * 1024 * 1024, files: 10 },
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
//  Transporter  (Gmail SMTP) – throws if creds missing
// ────────────────────────────────────────────────────────────────
if (!process.env.EMAIL_USER || !(process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD)) {
	throw new Error('EMAIL_USER and EMAIL_PASS (or EMAIL_PASSWORD) must be set in .env');
}

const transporter = nodemailer.createTransport({
	host: 'smtp.gmail.com',
	port: 465,
	secure: true, //  TLS
	auth: {
		user: process.env.EMAIL_USER,
		pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD,
	},
});

// ────────────────────────────────────────────────────────────────
//  Helper utilities
// ────────────────────────────────────────────────────────────────
const getTodayDate = () => {
	const d = new Date();
	return `${String(d.getDate()).padStart(2, '0')}_${String(d.getMonth() + 1).padStart(
		2,
		'0'
	)}_${d.getFullYear()}`;
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

// ────────────────────────────────────────────────────────────────
//  ▼▼▼  THREE  processing pipelines (unchanged)  ▼▼▼
// ────────────────────────────────────────────────────────────────
const processLacInfo = (workbooks) => {
	console.log('Processing LAC Info…');
	const out = [];

	workbooks.forEach((wb) => {
		wb.SheetNames.forEach((sheetName) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' }).forEach((row) => {
				const colsToDelete = [
					'id',
					'created_time',
					'ad_id',
					'ad_name',
					'adset_id',
					'adset_name',
					'campaign_id',
					'campaign_name',
					'form_id',
					'platform',
					'is_organic'
				];
				const r = processRow(row, colsToDelete);

				r.Type = 'Piste'; //  add column
				if (r.form_name !== undefined) {
					r.opportunité = r.form_name;
					delete r.form_name;
				}

				if (r.opportunité) {
					const v = String(r.opportunité).toLowerCase();
					if (
						v.includes('linfo') ||
						v.includes('licence info') ||
						v.includes('licence informatique') ||
						v.includes('licence info 2025')
					)
						r.opportunité = 'Licence Informatique';
					else if (
						v.includes('lac') ||
						v.includes('Licence Sciences Commerciales Année 25-26') ||
						v.includes('licence commerce') ||
						v.includes('licence science commerciales') 
					)
						r.opportunité = 'Licence Science Commercial et marketing';
						
					else if (v.includes('lfc') || v.includes('licence finance'))
						r.opportunité = 'Licence Finance et Comptabilité';
				}
				if (r.phone_number) r.phone_number = String(r.phone_number).replace(/p:\+|p:/g, '');
				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	const wsNew = XLSX.utils.json_to_sheet(out);
	XLSX.utils.book_append_sheet(wbNew, wsNew, 'Processed Data');

	return {
		filename: `ads_ifag_${getTodayDate()}.xlsx`,
		buffer: XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx' }),
		rowCount: out.length,
	};
};

const processInsagCneIf = (workbooks) => {
	console.log('Processing Insag CNE IF…');
	const out = [];

	workbooks.forEach((wb) => {
		wb.SheetNames.forEach((sheetName) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' }).forEach((row) => {
				const colsToDelete = [
					'id',
					'created_time',
					'ad_id',
					'ad_name',
					'adset_id',
					'adset_name',
					'campaign_id',
					'campaign_name',
					'form_id',
					'is_organic',
					'platform',
				];
				const r = processRow(row, colsToDelete);

				if (r.form_name !== undefined) {
					r.opportunité = r.form_name;
					delete r.form_name;
				}
				if (r.opportunité && String(r.opportunité).includes('MBA Global CNE-copy'))
					r.opportunité = 'MBA Global CNE';

				r.business_unit = 'insfag_crm_sale.business_unit_diploma_courses';

				if (r.opportunité === 'MBA Global CNE') {
					r.company = 'insfag_root.secondary_company';
					r['product cible'] = 'insfag_crm_sale.product_template_mba_mos';
				} else if (String(r.opportunité || '').includes('Exécutive MBA Finance')) {
					r.company = 'base.main_company';
					r['product cible'] = 'insfag_crm_sale.product_template_emba_sfe';
				}
				if (r.phone_number) r.phone_number = String(r.phone_number).replace(/p:\+|p:/g, '');

				r.source = 'export.utm_source_11_b17eb5a0';
				r['Equipe commercial'] = 'export.crm_team_6_3cd792db';

				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');

	return {
		filename: `ads_insag_${getTodayDate()}.xlsx`,
		buffer: XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx' }),
		rowCount: out.length,
	};
};

const processAwareness = (workbooks) => {
	console.log('Processing Awareness…');
	const out = [];

	workbooks.forEach((wb) => {
		wb.SheetNames.forEach((sheetName) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' }).forEach((row) => {
				const colsToDelete = [
					'id',
					'created_time',
					'ad_id',
					'ad_name',
					'adset_id',
					'adset_name',
					'campaign_id',
					'campaign_name',
					'form_id',
					'form_name',
					'is_organic',
				];
				const r = processRow(row, colsToDelete);

				if (r.platform !== undefined) {
					r.Type = 'Piste';
					delete r.platform;
				}

				const longCol = 'par_quelles_formation_êtes-vous_intéressé_?';
				if (r[longCol] !== undefined) {
					r.opportunité = r[longCol];
					delete r[longCol];
				}

				if (r.opportunité) {
					const v = String(r.opportunité).toLowerCase();
					if (v.includes('linfo') || v.includes('licence info') || v.includes('licence_informatique'))
						r.opportunité = 'Licence informatique';
					else if (
						v.includes('lac') ||
						v.includes('licence commerce') ||
						v.includes('licence_commerce_&_marketing')
					)
						r.opportunité = 'Licence Science Commercial et marketing';
					else if (v.includes('lfc') || v.includes('licence_finance_et_comptabilité'))
						r.opportunité = 'Licence Finance et Comptabilité';
					else if (v.includes('master mm') || v.includes('master_marketing_&_management'))
						r.opportunité = 'Master Marketing Management';
					else if (v.includes('master_en_transformation_digitale_et_e-business'))
						r.opportunité = 'Master Transformation digital et E-Business';
				}

				if (r.phone) r.phone = String(r.phone).replace(/p:\+|p:/g, '');

				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');

	return {
		filename: `ads_awarness_ifag_${getTodayDate()}.xlsx`,
		buffer: XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx' }),
		rowCount: out.length,
	};
};

// ────────────────────────────────────────────────────────────────
//  POST  /api/process
// ────────────────────────────────────────────────────────────────
app.post('/api/process', upload.array('files'), async (req, res) => {
	try {
		const files = req.files;
		const options = JSON.parse(req.body.options || '{}');
		const email = req.body.email;

		if (!files?.length) return res.status(400).json({ error: 'No files uploaded' });
		if (!/@/.test(email || '')) return res.status(400).json({ error: 'Valid email address required' });

		const workbooks = files.map((f) => readFileAsWorkbook(f.buffer, f.originalname));

		const processed = [];
		const summary = [];

		if (options.lacInfo) {
			const r = processLacInfo(workbooks);
			processed.push(r);
			summary.push(`LAC Info: ${r.rowCount} rows`);
		}
		if (options.insagCneIf) {
			const r = processInsagCneIf(workbooks);
			processed.push(r);
			summary.push(`Insag CNE IF: ${r.rowCount} rows`);
		}
		if (options.awareness) {
			const r = processAwareness(workbooks);
			processed.push(r);
			summary.push(`Awareness: ${r.rowCount} rows`);
		}

		if (!processed.length) return res.status(400).json({ error: 'No processing option selected' });

		await transporter.sendMail({
			from: `File Processor <${process.env.EMAIL_USER}>`,
			to: email,
			subject: `Processed Excel files – ${new Date().toLocaleDateString()}`,
			html: `<p>Your files have been processed:</p><ul>${summary.map((s) => `<li>${s}</li>`).join('')}</ul>`,
			attachments: processed.map((p) => ({
				filename: p.filename,
				content: p.buffer,
				contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			})),
		});

		res.json({ success: true, filesProcessed: processed.length, details: summary });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
});

// ────────────────────────────────────────────────────────────────
//  Health + global error handler
// ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

app.use((err, _req, res, _next) => {
	if (err instanceof multer.MulterError) {
		if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 50 MB)' });
		if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files (max 10)' });
	}
	res.status(500).json({ error: err.message });
});

// ────────────────────────────────────────────────────────────────
//  Boot
// ────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
