var debug = require('../../utils').debug
	, f = require('util').format
	, Instrumentor = require('./instrumentor')
	, CoverageData = require('./coverage_data')
	, TreeSummarizer = require('./tree-summarizer')
	, Html = require('../cover/cover_reporters/html')
	, path = require('path')
	, utils = require('./object-utils')
	, mkdirp = require('mkdirp')
	, fs = require('fs');

var RCover = function(options) {	
	var logger = debug('RCover');

	// Save the original require extension
	var originalRequire = require.extensions['.js'];
	var coverOptions = options || {};
	if(!coverOptions.includes) coverOptions.includes = ["./lib"];

	// Output directory
	coverOptions.outputDirectory = coverOptions.outputDirectory || "./out";
	coverOptions.outputDirectory = coverOptions.outputDirectory + "/rcover";

	// Coverage options
	coverOptions.dumpToJson = coverOptions.dumpToJson || false;

	// Keeps all the coverage data
	global.__coverage__ = new CoverageData(coverOptions);

	// Coverage instrumentor
	var instrumentor = new Instrumentor({
    debug: false,
    walkDebug: false,
    coverageVariable: '__coverage__.data',
    codeGenerationOptions: undefined,
    noAutoWrap: false,
    noCompact: false,
    embedSource: false,
    preserveComments: false
  });

	this.beforeInitialize = function(files, callback) {
		logger(coverOptions.logLevel, 'info', f("beforeInitialize"));

		// Override with our own
		require.extensions['.js'] = function(module, filename) {
			logger(coverOptions.logLevel, 'info', f("loading file %s", filename));
			// Are we going to instrument it
			var instrument = true;

			// Check if it's in a node_module, and don't instrument if it is
			if(filename.indexOf('node_modules/') != -1) {
				instrument = false;
			}

			// The file is not on the passed in list, instrument it
			if(instrument) {
				logger(coverOptions.logLevel, 'info', f("instrumenting file %s", filename));
				// Otherwise instrument it
				var file = fs.readFileSync(filename).toString();			
				// Instrument the code
				var instrumentedCode = instrumentor.instrumentSync(file, filename);
				// Get the base name
				var baseName = path.basename(filename);
				// Relative path
				var relativePathFile = filename.replace(process.cwd(), "");
				var relativePath = filename.replace(process.cwd(), "").replace("/" + baseName, "");

				// Return the compiled module
				return module._compile(instrumentedCode, filename);
			}

			// Return the original module
			return originalRequire(module, filename);
		}		

		callback();
	}

	this.beforeStart = function(tests, callback) {
		logger(coverOptions.logLevel, 'info', f("beforeStart"));
		callback();
	}	

	this.beforeExit = function(tests, callback) {
		logger(coverOptions.logLevel, 'info', f("beforeExit"));

		// Get all the dictionaries
		var dictionaries = __coverage__.getDataDictionaries();
		var index = 0;

		// Iterate over all the entries
		for(var name in dictionaries) {
			var test = dictionaries[name].test;
			var data = dictionaries[name].data;

			// Create an instance of the Tree Summarizer
			var summarizer = new TreeSummarizer();
			// Set up html options
			var htmlOptions = options || {};
			// Add the current test name as the report name
			htmlOptions.reportSubDirectory = "" + (index++);
			htmlOptions.noDelete = true;
			// Generate a new html report
			var generator = new Html(htmlOptions);

			// For each file in coverage, let's generate
			for(var filename in data) {
				// Get the coverage
				var coverage = data[filename];
				
				// Add content to summarizer
				summarizer.addFileCoverageSummary(filename, utils.summarizeFileCoverage(coverage));
			}	

			// Get the tree summary
			var tree = summarizer.getTreeSummary();
			// Execute generation of html page
			generator.generate(tree.root, data);

			// If we want to dump the json result to file
			if(coverOptions.dumpToJson) {
				// Generate a json object for the test that we can use later
				var coverageReport = {
						test: test
					,	data: data
				}

				// Filename
				var filename = f("%s/%s.json", coverOptions.outputDirectory, index);
				// Log the file
				logger(coverOptions.logLevel, 'info', f("writing json file %s for test [%s]", filename, test.name));
				// Write to file
				fs.writeFileSync(filename, JSON.stringify(coverageReport, function(key, value) {
					if(key == 'module') return undefined;
					if(key == 'test' && value.name == null) return undefined;
					return value;
				}, 2), 'utf8');				
			}
		}

		callback();
	}

	this.beforeTest = function(test, callback) {
		logger(coverOptions.logLevel, 'info', f("beforeTest"));
		__coverage__.setCurrentDictionary(test.name, test);
		callback();
	}	

	this.afterTest = function(test, callback) {
		logger(coverOptions.logLevel, 'info', f("afterTest"));
		__coverage__.unsetCurrentDictionary();
		callback();
	}	
}

module.exports = RCover;