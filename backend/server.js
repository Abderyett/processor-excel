// ────────────────────────────────────────────────────────────────
//  server.js  –  File processor + email sender + Compare & Clean
//               FIXED: Added proper error handling and logging
// ────────────────────────────────────────────────────────────────
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const cors = require('cors');
const dotenv = require('dotenv');

// Fix for path-to-regexp error
process.env.DEBUG = '';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;

// ────────────────────────────────────────────────────────────────
//  CORS Configuration
// ────────────────────────────────────────────────────────────────
app.use(
	cors({
		origin: true,
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
	})
);

// Handle preflight requests
app.options('*', cors());

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
		if (okMime.includes(file.mimetype) || /\.(xlsx?|csv)$/i.test(file.originalname)) return cb(null, true);
		cb(new Error('Invalid file type. Only Excel and CSV files are allowed.'));
	},
});

// ────────────────────────────────────────────────────────────────
//  Mail transporter (Gmail SMTP)
// ────────────────────────────────────────────────────────────────
if (!process.env.EMAIL_USER || !(process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD))
	throw new Error('EMAIL_USER and EMAIL_PASS (or EMAIL_PASSWORD) must be set in .env');

const transporter = nodemailer.createTransport({
	host: 'smtp.gmail.com',
	port: 465,
	secure: true,
	auth: {
		user: process.env.EMAIL_USER,
		pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD,
	},
});

// Verify transporter on startup
transporter
	.verify()
	.then(() => console.log('✅ Email transporter ready'))
	.catch((err) => console.error('❌ Email transporter error:', err.message));

// ────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────
const getTodayDate = () => {
	const d = new Date();
	return `${String(d.getDate()).padStart(2, '0')}_${String(d.getMonth() + 1).padStart(
		2,
		'0'
	)}_${d.getFullYear()}`;
};

const readFileAsWorkbook = (buffer, fn) => {
	try {
		return XLSX.read(buffer, { type: 'buffer', cellDates: true });
	} catch (e) {
		console.error(`Error reading ${fn}:`, e);
		throw new Error(`Cannot read ${fn}: ${e.message}`);
	}
};

const processRow = (row, cols) => {
	const copy = { ...row };
	cols.forEach((c) => delete copy[c]);
	return copy;
};

/*────────────────────────────────────────────────────────────────
  Canonicalise PHONE
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
	if (!key) return row;

	let phone = String(row[key])
		.replace(/p:\+|p:/gi, '')
		.replace(/\D/g, '')
		.trim();

	if (phone.startsWith('033')) {
		phone = phone.slice(3);
	} else if (phone.startsWith('33')) {
		phone = phone.slice(2);
	} else if (phone.startsWith('213')) {
		phone = phone.slice(3);
	} else if (phone.startsWith('1')) {
		phone = phone.slice(1);
	}

	if (phone.length === 9 && !phone.startsWith('0')) {
		phone = '0' + phone;
	}

	if (phone.length === 10) {
		phone = `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`;
	}

	if (phone.length > 0) {
		row.phone_number = phone;
	}

	if (key !== 'phone_number') {
		delete row[key];
	}

	return row;
};

/*────────────────────────────────────────────────────────────────
  Canonicalise FULL NAME
────────────────────────────────────────────────────────────────*/
const normaliseFullName = (row) => {
	const candidates = ['full_name', 'fullname', 'Full Name', 'Full_Name', 'full name', 'FullName'];
	const key = candidates.find((k) => row[k] !== undefined && row[k] !== '');
	if (!key) return row;

	row.full_name = String(row[key]).trim();
	if (key !== 'full_name') delete row[key];
	return row;
};

/*────────────────────────────────────────────────────────────────
  Text normalization
────────────────────────────────────────────────────────────────*/
const normalizeText = (text) => {
	if (!text) return '';
	return String(text)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^\w\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
};

/*────────────────────────────────────────────────────────────────
  Product assignment
────────────────────────────────────────────────────────────────*/
const assignProductFromText = (row) => {
	if (row['product cible']) {
		return row;
	}

	const allText = Object.values(row)
		.filter((val) => val !== null && val !== undefined && val !== '')
		.map((val) => normalizeText(String(val)))
		.join(' ');

	const patterns = [
		{
			keywords: ['dmb', 'digital marketing', 'marketing digital'],
			product: 'insfag_crm_sale.product_template_mba_dmk',
			company: 'base.main_company',
		},
		{
			keywords: ['marketing'],
			product: 'insfag_crm_sale.product_template_ms_mrk',
			company: 'base.main_company',
		},
		{
			keywords: ['rh', 'ressources humaines', 'resources humaines'],
			product: 'insfag_crm_sale.product_template_ms_rh',
			company: 'base.main_company',
		},
		{
			keywords: ['finance', 'financier'],
			product: 'insfag_crm_sale.product_template_ms_fin',
			company: 'base.main_company',
		},
		{
			keywords: ['master assurances', 'mma', 'assurance'],
			product: 'insfag_crm_sale.product_template_ms_mas',
			company: 'base.main_company',
		},
		{
			keywords: ['agent general d assurance', 'agent general dassurance', 'aga'],
			product: 'insfag_crm_sale.product_template_bac_aga',
			company: 'base.main_company',
		},
		{
			keywords: ['digital'],
			product: 'insfag_crm_sale.product_template_mba_dmk',
			company: 'base.main_company',
		},
		{
			keywords: ['Global', 'management opérationnel', 'GMBA'],
			product: 'insfag_crm_sale.product_template_mba_dmk',
			company: 'base.main_company',
		},
	];

	for (const pattern of patterns) {
		for (const keyword of pattern.keywords) {
			if (allText.includes(keyword)) {
				row['product cible'] = pattern.product;
				if (!row.company) {
					row.company = pattern.company;
				}
				return row;
			}
		}
	}

	return row;
};

const normaliseRow = (row) => {
	normalisePhone(row);
	normaliseFullName(row);
	assignProductFromText(row);
	return row;
};

// ────────────────────────────────────────────────────────────────
//  Compare-and-Clean utilities
// ────────────────────────────────────────────────────────────────
const extractDateFromFilename = (fn) => {
	const m = fn.match(/(\d{2})_(\d{2})(?:_(\d{4}))?/);
	if (!m) return null;
	const [, dd, mm, yyyy] = m;
	return new Date(parseInt(yyyy || new Date().getFullYear(), 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
};

const determineNewerFile = (f1, f2) => {
	const d1 = extractDateFromFilename(f1.originalname);
	const d2 = extractDateFromFilename(f2.originalname);
	if (!d1 || !d2) return f1;
	return d1 > d2 ? f1 : f2;
};

const compareAndClean = (files) => {
	if (files.length !== 2) throw new Error('Compare and Clean requires exactly 2 files');

	const [f1, f2] = files;
	const newer = determineNewerFile(f1, f2);
	const older = newer === f1 ? f2 : f1;

	const wbNewer = readFileAsWorkbook(newer.buffer, newer.originalname);
	const wbOlder = readFileAsWorkbook(older.buffer, older.originalname);

	const olderEmails = new Set();
	wbOlder.SheetNames.forEach((sh) => {
		XLSX.utils.sheet_to_json(wbOlder.Sheets[sh], { defval: '' }).forEach((row) => {
			const email =
				row.email ||
				row.Email ||
				row.EMAIL ||
				row.email_address ||
				row['Email Address'] ||
				row.mail ||
				row.Mail;
			if (typeof email === 'string' && email.includes('@')) olderEmails.add(email.toLowerCase().trim());
		});
	});

	const cleaned = [];
	let dupes = 0,
		total = 0;
	wbNewer.SheetNames.forEach((sh) => {
		XLSX.utils.sheet_to_json(wbNewer.Sheets[sh], { defval: '' }).forEach((row) => {
			total++;
			const email =
				row.email ||
				row.Email ||
				row.EMAIL ||
				row.email_address ||
				row['Email Address'] ||
				row.mail ||
				row.Mail;
			if (email && olderEmails.has(email.toLowerCase().trim())) {
				dupes++;
				return;
			}
			cleaned.push(row);
		});
	});

	const wbOut = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(cleaned), 'Cleaned Data');
	const base = newer.originalname.replace(/\.(xlsx?|csv)$/i, '');
	const ext = newer.originalname.match(/\.(xlsx?|csv)$/i)?.[0] || '.xlsx';

	return {
		filename: `${base}_clean${ext}`,
		buffer: XLSX.write(wbOut, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount: cleaned.length,
		duplicatesRemoved: dupes,
		totalOriginalRows: total,
		olderFileName: older.originalname,
		newerFileName: newer.originalname,
	};
};

// ────────────────────────────────────────────────────────────────
//  Processing Pipelines
// ────────────────────────────────────────────────────────────────
const processLacInfo = (wbs) => {
	const out = [];
	wbs.forEach((wb) => {
		wb.SheetNames.forEach((sheet) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).forEach((row) => {
				const r = processRow(row, [
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
					'is_organic',
					'lead_status',
				]);

				r.Type = 'Piste';
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
						v.includes('licence commerce') ||
						v.includes('licence science commerciales') ||
						v.includes('licence sciences commerciales année 25-26')
					)
						r.opportunité = 'Licence Science Commercial et marketing';
					else if (v.includes('lfc') || v.includes('licence finance'))
						r.opportunité = 'Licence Finance et Comptabilité';
				}

				normaliseRow(r);
				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');
	return {
		filename: `ads_ifag_${getTodayDate()}.xlsx`,
		buffer: XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount: out.length,
	};
};

const processInsagCneIf = (wbs) => {
	const out = [];
	wbs.forEach((wb) => {
		wb.SheetNames.forEach((sheet) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).forEach((row) => {
				const r = processRow(row, [
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
				]);

				if (r.form_name !== undefined) {
					r.opportunité = r.form_name;
					delete r.form_name;
				}

				if (r.opportunité) {
					let opp = String(r.opportunité);
					if (opp.includes('MBA Global CNE-copy')) {
						r.opportunité = 'MBA Global CNE';
					} else if (opp === 'CNE') {
						r.opportunité = 'MBA Global CNE';
					}
					if (opp.includes('MBA Global Octobre')) {
						r.opportunité = 'MBA Global Alger';
					}
				}

				r.bu = 'insfag_crm_sale.business_unit_diploma_courses';

				if (r.opportunité === 'MBA Global CNE') {
					r.company = 'insfag_root.secondary_company';
					r['product cible'] = 'insfag_crm_sale.product_template_mba_mos';
				} else if (
					String(r.opportunité || '').includes('MBA Global Octobre 24') ||
					String(r.opportunité || '').includes('MBA Global Alger')
				) {
					r.company = 'base.main_company';
					r.source = '__export__.utm_source_11_b17eb5a0';
					r['Equipe commercial'] = '__export__.crm_team_6_3cd792db';
					r['product cible'] = 'insfag_crm_sale.product_template_mba_mos';
				} else if (String(r.opportunité || '').includes('Exécutive MBA Finance')) {
					r.company = 'base.main_company';
					r['product cible'] = 'insfag_crm_sale.product_template_emba_sfe';
				}

				normaliseRow(r);

				if (!r.source) {
					r.source = '__export__.utm_source_11_b17eb5a0';
				}
				if (!r['Equipe commercial']) {
					r['Equipe commercial'] = '__export__.crm_team_6_3cd792db';
				}

				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');
	return {
		filename: `ads_insag_${getTodayDate()}.xlsx`,
		buffer: XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount: out.length,
	};
};

const processAwareness = (wbs) => {
	const out = [];
	wbs.forEach((wb) => {
		wb.SheetNames.forEach((sheet) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).forEach((row) => {
				const r = processRow(row, [
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
				]);

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

				normaliseRow(r);
				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');
	return {
		filename: `ads_awareness_ifag_${getTodayDate()}.xlsx`,
		buffer: XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount: out.length,
	};
};

// ────────────────────────────────────────────────────────────────
//  Attachments
// ────────────────────────────────────────────────────────────────
const makeAttachment = ({ filename, buffer }) => ({
	filename,
	content: buffer.toString('base64'),
	encoding: 'base64',
	contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

// ────────────────────────────────────────────────────────────────
//  Main API Endpoint - FIXED
// ────────────────────────────────────────────────────────────────
app.post('/api/process', upload.array('files'), async (req, res) => {
	const startTime = Date.now();
	console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.log('📥 Processing request started');

	try {
		const files = req.files;
		const opts = JSON.parse(req.body.options || '{}');
		const email = req.body.email;

		console.log('📁 Files received:', files?.length || 0);
		console.log('⚙️  Options:', JSON.stringify(opts, null, 2));
		console.log('📧 Email:', email);

		// Validation
		if (!files?.length) {
			console.log('❌ No files uploaded');
			return res.status(400).json({ error: 'No files uploaded' });
		}
		if (!/@/.test(email || '')) {
			console.log('❌ Invalid email');
			return res.status(400).json({ error: 'Valid email required' });
		}

		const processed = [];
		const summary = [];

		// Process files based on options
		if (opts.compareAndClean) {
			console.log('🔄 Running Compare & Clean...');
			if (files.length !== 2) {
				return res.status(400).json({ error: 'Compare and Clean requires exactly 2 files' });
			}
			const result = compareAndClean(files);
			processed.push(result);
			summary.push(
				`Compare & Clean → ${result.duplicatesRemoved} duplicates removed (${result.rowCount}/${result.totalOriginalRows} rows kept)`
			);
			console.log('✅ Compare & Clean completed');
		} else {
			console.log('📊 Reading workbooks...');
			const wbs = files.map((f) => {
				console.log(`   - Reading: ${f.originalname}`);
				return readFileAsWorkbook(f.buffer, f.originalname);
			});
			console.log('✅ All workbooks read successfully');

			if (opts.lacInfo) {
				console.log('🔄 Processing LAC Info...');
				const result = processLacInfo(wbs);
				processed.push(result);
				summary.push(`LAC Info: ${result.rowCount} rows`);
				console.log(`✅ LAC Info completed: ${result.rowCount} rows`);
			}
			if (opts.insagCneIf) {
				console.log('🔄 Processing Insag CNE IF...');
				const result = processInsagCneIf(wbs);
				processed.push(result);
				summary.push(`Insag CNE IF: ${result.rowCount} rows`);
				console.log(`✅ Insag CNE IF completed: ${result.rowCount} rows`);
			}
			if (opts.awareness) {
				console.log('🔄 Processing Awareness...');
				const result = processAwareness(wbs);
				processed.push(result);
				summary.push(`Awareness: ${result.rowCount} rows`);
				console.log(`✅ Awareness completed: ${result.rowCount} rows`);
			}
		}

		if (!processed.length) {
			console.log('❌ No processing option selected');
			return res.status(400).json({ error: 'No processing option selected' });
		}

		// Send email
		console.log('📧 Preparing to send email...');
		const mailOptions = {
			from: `File Processor <${process.env.EMAIL_USER}>`,
			to: email,
			subject: opts.compareAndClean ? 'Cleaned Excel file' : 'Processed Excel files',
			html: `<p>Your files have been processed:</p><ul>${summary.map((s) => `<li>${s}</li>`).join('')}</ul>`,
			attachments: processed.map(makeAttachment),
		};

		// Send email with timeout
		const emailPromise = transporter.sendMail(mailOptions);
		const timeoutPromise = new Promise((_, reject) => 
			setTimeout(() => reject(new Error('Email timeout after 30 seconds')), 30000)
		);
		
		await Promise.race([emailPromise, timeoutPromise]);

		const duration = ((Date.now() - startTime) / 1000).toFixed(2);
		console.log(`✅ Email sent successfully in ${duration}s`);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		res.json({
			success: true,
			filesProcessed: processed.length,
			details: summary,
			processingTime: `${duration}s`,
		});
	} catch (err) {
		const duration = ((Date.now() - startTime) / 1000).toFixed(2);
		console.error('❌ Error after', duration, 's:', err);
		console.error('Stack trace:', err.stack);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

		res.status(500).json({
			error: err.message,
			details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
		});
	}
});

// ────────────────────────────────────────────────────────────────
//  Health Check
// ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
	res.json({
		status: 'OK',
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	});
});

app.get('/test', (_req, res) => {
	console.log('🔍 Test endpoint hit');
	res.json({
		message: 'Server is working',
		timestamp: new Date().toISOString(),
		env: {
			emailConfigured: !!process.env.EMAIL_USER,
			port: PORT,
		},
	});
});

// ────────────────────────────────────────────────────────────────
//  Error Handler
// ────────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
	console.error('❌ Global error handler:', err);

	if (err instanceof multer.MulterError) {
		if (err.code === 'LIMIT_FILE_SIZE') {
			return res.status(400).json({ error: 'File too large (max 50 MB)' });
		}
		if (err.code === 'LIMIT_FILE_COUNT') {
			return res.status(400).json({ error: 'Too many files (max 10)' });
		}
		return res.status(400).json({ error: err.message });
	}

	res.status(500).json({
		error: err.message,
		details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
	});
});

// ────────────────────────────────────────────────────────────────
//  Start Server
// ────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
	console.log('\n🚀 ═══════════════════════════════════════');
	console.log(`🚀  Server running on port ${PORT}`);
	console.log(`🚀  Environment: ${process.env.NODE_ENV || 'development'}`);
	console.log(`🚀  Email user: ${process.env.EMAIL_USER}`);
	console.log('🚀 ═══════════════════════════════════════\n');
});
