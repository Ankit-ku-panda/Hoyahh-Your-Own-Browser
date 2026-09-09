import sys
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tor'))
spec = importlib.util.spec_from_file_location('tor_service', Path(__file__).resolve().parents[1] / 'tor/service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

class ProbeTests(unittest.TestCase):
    def test_check_requires_tor_and_remote_dns(self):
        result = subprocess.CompletedProcess([], 0, json.dumps({'IsTor':True,'IP':'185.220.101.1'}).encode())
        with patch.object(service.subprocess, 'run', return_value=result) as run:
            self.assertTrue(service.check_route()['tor_verified'])
            args = run.call_args.args[0]
            self.assertEqual(args[0:2], ['curl', '--disable'])
            self.assertEqual(args[args.index('--socks5-hostname')+1], '127.0.0.1:9050')
            self.assertEqual(args[-1], 'https://check.torproject.org/api/ip')
            self.assertNotIn('--location', args)
            run.assert_called_once()
    def test_non_tor_malformed_or_local_ip_rejected(self):
        for data in ({'IsTor':False,'IP':'185.220.101.1'}, {'IsTor':'true','IP':'185.220.101.1'}, {'IsTor':True,'IP':'127.0.0.1'}, []):
            result = subprocess.CompletedProcess([],0,json.dumps(data).encode())
            with patch.object(service.subprocess, 'run', return_value=result):
                with self.assertRaises(ValueError): service.check_route()
    def test_proxy_failure_has_no_retry_or_direct_fallback(self):
        with patch.object(service.subprocess, 'run', side_effect=subprocess.CalledProcessError(7, 'curl')) as run:
            with self.assertRaises(subprocess.CalledProcessError): service.check_route()
            run.assert_called_once()

if __name__ == '__main__': unittest.main()
