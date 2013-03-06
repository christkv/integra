var TestControl = require('./test_control').TestControl;

//
// Wraps a test suite
//
var TestSuite = function(formatter, configuration, name, files) {
  this.formatter = formatter;
  this.configuration = configuration;
  this.name = name;
  this.files = files;  

  // Statistics
  this.test_controls = [];
}

var process_files_serially = function(test_suite, configuration, files, options, callback) {
  var file = files.pop();
  var test = require(process.cwd() + file);

  runTests(test_suite, configuration, file, test, options, function() {
    if(files.length > 0) {
      process.nextTick(function() {
        process_files_serially(test_suite, configuration, files, options, callback);
      });
    } else {
      callback(null, []);
    }
  });
}

var process_files = function(test_suite, configuration, files, options, callback) {
  var number_of_files = files.length;
  // Load all the files
  for(var i = 0; i < files.length; i++) {
    console.log('\n' + test_suite.formatter.bold(files[i]));
    var test = require(process.cwd() + files[i]);

    runTests(test_suite, configuration, files[i], test, options, function() {
      number_of_files = number_of_files - 1;

      if(number_of_files == 0) {
        callback(null, []);
      }
    });
  }
}

var process_parallel_tests_serially = function(self, configuration, tests, options, callback) {
  var test = tests.pop();
  console.log("============================================== EXECUTE serially :: " + test.name);

  // Let's run the test
  // Done function
  var done_function = function(_test_control) {
    return function() {
      // Execute the tear down function
      configuration.teardown(function() {
        // If we have no assertion errors print test name
        if(_test_control.number_of_failed_assertions == 0) {
          console.log('✔ ' + _test_control.name);
        } else {
          console.log(test_suite.formatter.error('✖ ' + _test_control.name));
          // Assertions
          _test_control.assertions.forEach(function (a) {
            console.log('Assertion Message: ' + test_suite.formatter.assertion_message(a.message));
            console.log(a.stack + '\n');
          });
        }

        if(tests.length > 0) {
          process.nextTick(function() {
            process_parallel_tests_serially(self, configuration, tests, options, callback);
          })
        } else {
          callback(null, []);
        }
      });
    }
  }

  // Test control
  var test_control = new TestControl(configuration.name, test.file, test.name);
  test_control.done = done_function(test_control); 
  // Execute configuration setup
  configuration.setup(function() {
    process.nextTick(function() {
      // Execute the test
      test.test[test.name].apply(test.test, [configuration, test_control]);                
    });
  })

  //   // Set up the done function
  //   test_control.done = done_function(test_control); 
  //   // Execute it
  //   execute_function(test, name, test_control)();



  // var keys = Object.keys(test);
  // var number_of_tests = keys.length;

  // // Execute serially
  // if(options.execute_serially) {
  //   return process_tests_serially(test_suite, test, keys, configuration, file_name, options, callback);
  // }

  // // Iterate over all the functions
  // for(var name in test) {    
  //   // Test control
  //   var test_control = new TestControl(configuration.name, file_name, name);
    
  //   // Done function
  //   var done_function = function(_test_control) {
  //     return function() {
  //       // Execute the tear down function
  //       configuration.teardown(function() {
  //         // If we have no assertion errors print test name
  //         if(_test_control.number_of_failed_assertions == 0) {
  //           console.log('✔ ' + _test_control.name);
  //         } else {
  //           console.log(test_suite.formatter.error('✖ ' + _test_control.name));
  //           // Assertions
  //           _test_control.assertions.forEach(function (a) {
  //             console.log('Assertion Message: ' + test_suite.formatter.assertion_message(a.message));
  //             console.log(a.stack + '\n');
  //           });
  //         }

  //         // Adjust the number of tests left to run
  //         number_of_tests = number_of_tests - 1;
  //         if(number_of_tests == 0) {
  //           test_suite.test_controls.push(_test_control);
  //           callback(null, null);
  //         }                
  //       });
  //     }
  //   }

  //   var execute_function = function(_test, _name, _test_control) {
  //     return function() {
  //       configuration.setup(function() {
  //         // Execute the test
  //         _test[_name].apply(_test, [configuration, _test_control]);          
  //       })
  //     }
  //   }

  //   // Set up the done function
  //   test_control.done = done_function(test_control); 
  //   // Execute it
  //   execute_function(test, name, test_control)();
  // }  
}

TestSuite.prototype.execute_parallel = function(config_name, options, callback) {
  var self = this;
  var buckets = [];
  var tests = [];
  var number_of_contexts = options.number_of_contexts ? options.number_of_contexts : 1;
  var number_of_contexts_left = number_of_contexts;

  // Set up the context
  for(var i = 0; i < number_of_contexts; i++) buckets[i] = [];
  for(var i = 0; i < number_of_contexts; i++) tests[i] = [];

  // Start all the configurations
  this.configuration.createAndStart(config_name, number_of_contexts, function(err, configurations) {

    // If we have a file level, split files into buckets and run 
    // concurrently
    if(options.parallelize_level == 'file') {
      var index = 0;
      
      // Let's split files into x parallel buckets and distribute them
      for(var i = 0; i < self.files.length; i++) {
        buckets[index].push(self.files[i]);
        index = (index + 1) % number_of_contexts;
      }

      // Handle tests done
      var done = function(err) {
        number_of_contexts_left = number_of_contexts_left - 1;

        if(number_of_contexts_left == 0) {
          callback();
        }
      }

      // Run each bucket of files separately
      for(var i = 0; i < number_of_contexts; i++) {
        if(options.execute_serially) {
          process_files_serially(self, configurations[i], buckets[i], options, done);
        } else {
          process_files(self, configurations[i], buckets[i], options, done);        
        }
      }      
    } else if(options.parallelize_level == 'test') {
      var index = 0;

      // Handle tests done
      var done = function(err) {
        number_of_contexts_left = number_of_contexts_left - 1;

        if(number_of_contexts_left == 0) {
          callback();
        }
      }

      // Let's build the test objects that will run in parallel
      for(var i = 0; i < self.files.length; i++) {        
        var test = require(process.cwd() + self.files[i]);
        // Distribute the tests
        for(var name in test) {
          tests[index].push({test:test, name:name, file: self.files[i]});
          index = (index + 1) % number_of_contexts;
        }
      }

      // Sweet now run the tests serially
      for(var i = 0; i < number_of_contexts; i++) {
        console.log("++++++++++++++++++++++++ EXECUTE IN PARALLEL")
        process_parallel_tests_serially(self, configurations[i], tests[i], options, done);
      }
    } else {
      throw new Error("Parallelization level " + options.parallelize_level + " not valid");
    }
  });
}

TestSuite.prototype.execute = function(config_name, options, callback) {
  this.execute_parallel(config_name, options, callback);
}

var process_tests_serially = function(test_suite, tests, test_names, configuration, file_name, options, callback) {
  var test_name = test_names.pop();
  // Test control
  var test_control = new TestControl(configuration.name, file_name, test_name);
    
  // Done function
  var done_function = function(_test_control) {
    return function() {
      // Execute the tear down function
      configuration.teardown(function() {
        // If we have no assertion errors print test name
        if(_test_control.number_of_failed_assertions == 0) {
          console.log('✔ ' + _test_control.name);
        } else {
          console.log(test_suite.formatter.error('✖ ' + _test_control.name));
          // Assertions
          _test_control.assertions.forEach(function (a) {
            console.log('Assertion Message: ' + test_suite.formatter.assertion_message(a.message));
            console.log(a.stack + '\n');
          });
        }

        if(test_names.length > 0) {
          process.nextTick(function() {
            process_tests_serially(test_suite, tests, test_names, configuration, file_name, options, callback);
          })
        } else {
          test_suite.test_controls.push(_test_control);
          callback(null, null);
        }
      });
    }
  }

  // Set up the done function
  test_control.done = done_function(test_control); 
  // Execute the test setup
  configuration.setup(function() {
    // Execute the test
    tests[test_name].apply(tests, [configuration, test_control]);
  });
}

var runTests = function(test_suite, configuration, file_name, test, options, callback) {
  var keys = Object.keys(test);
  var number_of_tests = keys.length;

  // Execute serially
  if(options.execute_serially) {
    return process_tests_serially(test_suite, test, keys, configuration, file_name, options, callback);
  }

  // Iterate over all the functions
  for(var name in test) {    
    // Test control
    var test_control = new TestControl(configuration.name, file_name, name);
    
    // Done function
    var done_function = function(_test_control) {
      return function() {
        // Execute the tear down function
        configuration.teardown(function() {
          // If we have no assertion errors print test name
          if(_test_control.number_of_failed_assertions == 0) {
            console.log('✔ ' + _test_control.name);
          } else {
            console.log(test_suite.formatter.error('✖ ' + _test_control.name));
            // Assertions
            _test_control.assertions.forEach(function (a) {
              console.log('Assertion Message: ' + test_suite.formatter.assertion_message(a.message));
              console.log(a.stack + '\n');
            });
          }

          // Adjust the number of tests left to run
          number_of_tests = number_of_tests - 1;
          if(number_of_tests == 0) {
            test_suite.test_controls.push(_test_control);
            callback(null, null);
          }                
        });
      }
    }

    var execute_function = function(_test, _name, _test_control) {
      return function() {
        configuration.setup(function() {
          // Execute the test
          _test[_name].apply(_test, [configuration, _test_control]);          
        })
      }
    }

    // Set up the done function
    test_control.done = done_function(test_control); 
    // Execute it
    execute_function(test, name, test_control)();
  }  
}

exports.TestSuite = TestSuite;